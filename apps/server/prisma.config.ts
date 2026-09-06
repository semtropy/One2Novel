import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';
import { mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
const root = resolve(import.meta.dirname, '../..');
mkdirSync(resolve(root, 'data'), { recursive: true });
// On Windows the schema engine needs an existing SQLite file for an absolute file URL.
// Creating an empty file does not replace migrations or touch an existing database.
const defaultFile = resolve(root, 'data/one2novel.db');
if (!process.env.DATABASE_URL && !existsSync(defaultFile)) closeSync(openSync(defaultFile, 'wx'));
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      `file:${resolve(root, 'data/one2novel.db').replaceAll('\\', '/')}`,
  },
});
