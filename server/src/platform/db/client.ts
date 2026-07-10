import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { getEnv } from "../config/env";
import { resolveAppRuntimeMode } from "../config/appPaths";
import { MAX_CONNECTION_AGE_MS } from "../config/constants";
import path from "node:path";
import fs from "node:fs";

let prisma: PrismaClient | null = null;
let connectionCreatedAt: number | null = null;
let schemaPushed = false;

const TEMPLATE_DB = path.resolve(__dirname, "..", "..", "..", "prisma", "template.db");

/** Maximum connection age before forced reconnect (ms) — prevents SQLite WAL bloat */
export const MAX_CONNECTION_AGE_MS_CONST = MAX_CONNECTION_AGE_MS;

function resolveDbPath(dbUrl: string): string | null {
  if (!dbUrl.startsWith("file:")) return null;
  const relative = dbUrl.slice("file:".length);
  return path.isAbsolute(relative) ? relative : path.resolve(relative);
}

/** If the database is fresh, initialize it from the pre-built template */
function ensureSchema(): void {
  if (schemaPushed) return;

  const env = getEnv();
  const dbPath = resolveDbPath(env.DATABASE_URL);
  if (!dbPath) return;

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Check if database already has tables
  if (fs.existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Novel' LIMIT 1").get();
        if (row) {
          schemaPushed = true;
          return;
        }
      } finally {
        db.close();
      }
    } catch {
      // Corrupt or unreadable, will be replaced
    }
  }

  // Fresh database — copy template
  if (!fs.existsSync(TEMPLATE_DB)) {
    console.warn("[db] Template database not found at", TEMPLATE_DB);
    return;
  }

  try {
    fs.copyFileSync(TEMPLATE_DB, dbPath);
    console.log("[db] Database initialized from template.");
    schemaPushed = true;
  } catch (err) {
    console.error("[db] Database init failed:", err instanceof Error ? err.message : err);
  }
}

function createPrismaClient(): PrismaClient {
  const env = getEnv();
  ensureSchema();
  const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL as ":memory:" | (string & {}) });
  connectionCreatedAt = Date.now();
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient();
  }
  return prisma;
}

/**
 * Check database connection health.
 * Returns status, connection age, and whether a reconnect is needed.
 */
export async function checkDbHealth(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  connectionAgeMs: number;
  maxConnectionAgeMs: number;
  needsReconnect: boolean;
}> {
  if (!prisma || !connectionCreatedAt) {
    return { status: "unhealthy", connectionAgeMs: 0, maxConnectionAgeMs: MAX_CONNECTION_AGE_MS_CONST, needsReconnect: false };
  }

  const connectionAgeMs = Date.now() - connectionCreatedAt;
  const needsReconnect = connectionAgeMs >= MAX_CONNECTION_AGE_MS_CONST;

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: needsReconnect ? "degraded" : "healthy",
      connectionAgeMs,
      maxConnectionAgeMs: MAX_CONNECTION_AGE_MS_CONST,
      needsReconnect,
    };
  } catch {
    return { status: "unhealthy", connectionAgeMs, maxConnectionAgeMs: MAX_CONNECTION_AGE_MS_CONST, needsReconnect: true };
  }
}

/**
 * Ensure the Prisma connection is healthy.
 * Reconnects if the connection is stale or failed.
 * Call this before critical operations or in a middleware.
 */
export async function ensureHealthyPrisma(): Promise<PrismaClient> {
  if (!prisma) {
    prisma = createPrismaClient();
    return prisma;
  }

  const health = await checkDbHealth();
  if (health.needsReconnect) {
    try {
      await prisma.$disconnect();
    } catch { /* ignore disconnect errors */ }
    prisma = createPrismaClient();
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    connectionCreatedAt = null;
  }
}
