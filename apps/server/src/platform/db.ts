import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { asJson, canonical, hash, requireThat, uuid } from './core.js';
export type DB = PrismaClient;
export type Tx = Prisma.TransactionClient;
function findRoot() {
  let dir = import.meta.dirname;
  while (!existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    requireThat(parent !== dir, 'WORKSPACE_NOT_FOUND', '找不到工作区根目录');
    dir = parent;
  }
  return dir;
}
export const workspaceRoot = findRoot();
export const databaseUrl = () =>
  process.env.DATABASE_URL ||
  `file:${resolve(workspaceRoot, 'data/one2novel.db').replaceAll('\\', '/')}`;
export function databaseFilePath(url = databaseUrl()) {
  requireThat(url.startsWith('file:'), 'INVALID_DATABASE_URL', 'SQLite DATABASE_URL必须使用file:');
  const raw = decodeURIComponent(url.slice('file:'.length));
  const normalized = raw.startsWith('//') ? raw.slice(2) : raw;
  return isAbsolute(normalized) ? normalized : resolve(workspaceRoot, normalized);
}
export function dataDirectory(url = databaseUrl()) {
  return dirname(databaseFilePath(url));
}
export function createDb(url = databaseUrl()) {
  mkdirSync(dataDirectory(url), { recursive: true });
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
    transactionOptions: { timeout: 5000, maxWait: 5000 },
  });
}
export async function initializeDb(db: DB) {
  await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await db.$queryRawUnsafe('PRAGMA foreign_keys=ON');
  await db.$queryRawUnsafe('PRAGMA busy_timeout=5000');
  await db.project.count();
}
export async function artifact(
  db: Tx | DB,
  projectId: string,
  kind: string,
  payload: unknown,
  baseSnapshotId: string | null = null,
  jobId: string | null = null,
) {
  return db.artifact.create({
    data: {
      id: uuid(),
      projectId,
      kind,
      payload: asJson(payload),
      hash: hash(payload),
      baseSnapshotId,
      jobId,
    },
  });
}
export async function getArtifact<T = unknown>(db: DB, id: string, projectId?: string): Promise<T> {
  const a = await db.artifact.findUnique({ where: { id } });
  requireThat(a && (!projectId || a.projectId === projectId), 'NOT_FOUND', '找不到产物', 404);
  requireThat(hash(a.payload) === a.hash, 'ARTIFACT_CORRUPTED', '产物校验失败');
  return a.payload as T;
}
