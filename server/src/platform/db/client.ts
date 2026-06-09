import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { getEnv } from "../config/env";
import path from "node:path";
import fs from "node:fs";

let prisma: PrismaClient;
let schemaPushed = false;

const TEMPLATE_DB = path.resolve(__dirname, "..", "..", "..", "prisma", "template.db");

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

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const env = getEnv();
    ensureSchema();
    const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL as ":memory:" | (string & {}) });
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
