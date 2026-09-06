import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export function migrateTestDb(db: Database.Database) {
  const root = resolve('apps/server/prisma/migrations');
  for (const entry of readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    db.exec(readFileSync(resolve(root, entry.name, 'migration.sql'), 'utf8'));
  }
}
