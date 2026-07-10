/**
 * Schema Migration Service — lightweight version tracking for SQLite databases.
 *
 * Since One2Novel uses `prisma db push` (not `prisma migrate`), we track schema
 * versions at runtime via a `SchemaVersion` table. This enables:
 * 1. Detecting when the database schema is out of date
 * 2. Running data migration scripts between schema versions
 * 3. Automatic rollback on migration failure
 * 4. Desktop app showing schema version in settings
 */
import { getPrisma, disconnectPrisma } from "./client";
import { logEventError } from "../logging/eventErrorLog";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ─── Types ──────────────────────────────────────────────────

export interface MigrationResult {
  /** Whether any migration was applied */
  migrated: boolean;
  /** Previous schema version (null if first run) */
  fromVersion: number | null;
  /** Target schema version */
  toVersion: number;
  /** Whether a rollback occurred due to migration failure */
  rolledBack: boolean;
  /** Description of what was done */
  message: string;
}

export interface MigrationScript {
  /** Target version this migration upgrades to */
  version: number;
  /** Human-readable description */
  description: string;
  /** Apply the migration */
  apply: (prisma: unknown) => Promise<void>;
  /** Roll back the migration (called on failure) */
  rollback: (prisma: unknown) => Promise<void>;
}

// ─── Current schema version ─────────────────────────────────
// Increment this when schema.prisma changes (new tables, new fields, etc.)
export const CURRENT_SCHEMA_VERSION = 2;

// ─── Migration Scripts ──────────────────────────────────────
// Each script is reversible. Add new scripts here as schema evolves.

const MIGRATIONS: MigrationScript[] = [
  // v1: Initial schema version tracking
  {
    version: 1,
    description: "Initial schema version tracking",
    apply: async (prisma: unknown) => {
      const p = prisma as { schemaVersion: { upsert: (args: unknown) => Promise<unknown> } };
      await p.schemaVersion.upsert({
        where: { id: 1 },
        update: { version: 1 },
        create: {
          id: 1,
          version: 1,
          description: "Initial schema version tracking",
          appliedAt: new Date(),
          checksum: computeSchemaChecksum(),
        },
      });
    },
    rollback: async (prisma: unknown) => {
      const p = prisma as { schemaVersion: { deleteMany: (args: { where: { id: number } }) => Promise<unknown> } };
      await p.schemaVersion.deleteMany({ where: { id: 1 } });
    },
  },
  // v2: Chapter Commit + Projection system
  {
    version: 2,
    description: "Add ChapterCommit, ProjectionRun, StoryEvent tables + backfill",
    apply: async (prisma: unknown) => {
      const p = prisma as {
        schemaVersion: { upsert: (args: unknown) => Promise<unknown> };
        chapter: { findMany: (args: unknown) => Promise<Array<{ id: string; qualityScore: number | null; repairHistory: string | null; chapterStatus: string; order: number; novelId: string }>> };
        chapterCommit: { count: (args: unknown) => Promise<number>; create: (args: unknown) => Promise<unknown> };
      };

      // Record the version
      await p.schemaVersion.upsert({
        where: { id: 1 },
        update: { version: 2, description: "Chapter Commit + Projection system" },
        create: {
          id: 1,
          version: 2,
          description: "Chapter Commit + Projection system",
          appliedAt: new Date(),
          checksum: computeSchemaChecksum(),
        },
      });

      // Backfill: create retroactive commits for chapters without one
      const chapters = await p.chapter.findMany({
        where: { chapterStatus: "completed" },
        select: { id: true, qualityScore: true, repairHistory: true, order: true, novelId: true },
      });

      let backfilled = 0;
      for (const chapter of chapters) {
        const count = await p.chapterCommit.count({
          where: { chapterId: chapter.id },
        });
        if (count === 0) {
          await p.chapterCommit.create({
            data: {
              novelId: chapter.novelId,
              chapterId: chapter.id,
              chapterOrder: chapter.order,
              qualityScore: chapter.qualityScore ?? undefined,
              status: "accepted",
              acceptedAt: new Date(),
              projectionStatus: "completed",
            },
          });
          backfilled++;
        }
      }

      if (backfilled > 0) {
        console.log(`[Migration v2] Backfilled ${backfilled} retroactive commits`);
      }
    },
    rollback: async (prisma: unknown) => {
      const p = prisma as { schemaVersion: { update: (args: unknown) => Promise<unknown> } };
      await p.schemaVersion.update({
        where: { id: 1 },
        data: { version: 1, description: "Initial schema version tracking" },
      });
    },
  },
];

// ─── Checksum ───────────────────────────────────────────────

/** Compute a hash of the schema.prisma file for integrity checking */
function computeSchemaChecksum(): string {
  try {
    const schemaPath = path.resolve(__dirname, "..", "..", "..", "prisma", "schema.prisma");
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, "utf-8");
      return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
    }
  } catch { /* best-effort */ }
  return "unknown";
}

// ─── Backup ─────────────────────────────────────────────────

/** Create a backup of the current database file */
async function createDatabaseBackup(): Promise<string | null> {
  try {
    const env = await import("../config/env").catch(() => ({}));
    // Use the data root to find the database
    const { resolveDataRoot } = await import("../config/appPaths");
    const dataRoot = resolveDataRoot();
    const dbPath = path.join(dataRoot, "dev.db");

    if (!fs.existsSync(dbPath)) return null;

    const backupDir = path.join(dataRoot, "backups", `schema-migration-${Date.now()}`);
    fs.mkdirSync(backupDir, { recursive: true });

    // Copy the database file
    fs.copyFileSync(dbPath, path.join(backupDir, "dev.db"));

    // Copy WAL/SHM files if they exist
    for (const ext of ["-wal", "-shm"]) {
      const walPath = dbPath + ext;
      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, path.join(backupDir, `dev.db${ext}`));
      }
    }

    return backupDir;
  } catch (e) {
    logEventError("migration.backup", {}, e);
    return null;
  }
}

/** Restore database from a backup directory */
async function restoreDatabaseBackup(backupDir: string | null): Promise<void> {
  if (!backupDir || !fs.existsSync(backupDir)) return;

  try {
    const { resolveDataRoot } = await import("../config/appPaths");
    const dataRoot = resolveDataRoot();
    const dbPath = path.join(dataRoot, "dev.db");

    const backupDb = path.join(backupDir, "dev.db");
    if (fs.existsSync(backupDb)) {
      fs.copyFileSync(backupDb, dbPath);
    }

    // Restore WAL/SHM files
    for (const ext of ["-wal", "-shm"]) {
      const backupWal = path.join(backupDir, `dev.db${ext}`);
      const walPath = dbPath + ext;
      if (fs.existsSync(backupWal)) {
        fs.copyFileSync(backupWal, walPath);
      }
    }
  } catch (e) {
    logEventError("migration.restore", { backupDir }, e);
  }
}

// ─── Main Migration Orchestrator ────────────────────────────

/**
 * Ensure the database schema is up to date.
 *
 * This is called at server startup. It:
 * 1. Checks the current schema version in the database
 * 2. Compares against CURRENT_SCHEMA_VERSION
 * 3. Applies any pending migrations
 * 4. Rolls back on failure
 */
export async function ensureSchemaMigrated(): Promise<MigrationResult> {
  let prisma: unknown = null;
  let backupDir: string | null = null;
  let rolledBack = false;

  try {
    const { getPrisma: getPr } = await import("./client");
    prisma = getPr();

    // Read current version
    let fromVersion: number | null = null;
    try {
      const p = prisma as { schemaVersion: { findUnique: (args: { where: { id: number } }) => Promise<{ version: number } | null> } };
      const existing = await p.schemaVersion.findUnique({ where: { id: 1 } });
      fromVersion = existing?.version ?? null;
    } catch {
      // SchemaVersion table doesn't exist yet — first run, no migration needed
      fromVersion = 0;
    }

    if ((fromVersion ?? 0) >= CURRENT_SCHEMA_VERSION) {
      return {
        migrated: false,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        rolledBack: false,
        message: fromVersion === CURRENT_SCHEMA_VERSION
          ? `Schema version ${CURRENT_SCHEMA_VERSION} is up to date.`
          : `Schema version ${fromVersion} is ahead of expected ${CURRENT_SCHEMA_VERSION}.`,
      };
    }

    // Backup before migration
    backupDir = await createDatabaseBackup();

    // Apply pending migrations
    for (const migration of MIGRATIONS) {
      if (migration.version > (fromVersion ?? 0)) {
        try {
          await migration.apply(prisma);
        } catch (e) {
          // Rollback on failure
          if (backupDir) {
            await restoreDatabaseBackup(backupDir);
          }
          try {
            await migration.rollback(prisma);
          } catch { /* rollback of rollback — best effort */ }
          rolledBack = true;
          return {
            migrated: false,
            fromVersion,
            toVersion: CURRENT_SCHEMA_VERSION,
            rolledBack: true,
            message: `Migration v${migration.version} failed and was rolled back.`,
          };
        }
      }
    }

    return {
      migrated: true,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      rolledBack: false,
      message: `Schema migrated from v${fromVersion ?? 0} to v${CURRENT_SCHEMA_VERSION}.`,
    };
  } catch (e) {
    logEventError("migration.ensure", {}, e);
    return {
      migrated: false,
      fromVersion: null,
      toVersion: CURRENT_SCHEMA_VERSION,
      rolledBack: false,
      message: `Migration check failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}

/** Get the current schema version from the database */
export async function getSchemaVersion(): Promise<{ version: number | null; checksum: string | null }> {
  try {
    const { getPrisma: getPr } = await import("./client");
    const prisma = getPr();
    const p = prisma as unknown as { schemaVersion: { findUnique: (args: { where: { id: number } }) => Promise<{ version: number; checksum?: string } | null> } };
    const existing = await p.schemaVersion.findUnique({ where: { id: 1 } });
    return { version: existing?.version ?? null, checksum: existing?.checksum ?? null };
  } catch {
    return { version: null, checksum: null };
  }
}
