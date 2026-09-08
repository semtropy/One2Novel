import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { AppError } from './core.js';
import { dataDirectory, databaseFilePath, databaseUrl } from './db.js';

type DataLock = {
  release(): void;
  path: string;
};

type LockPayload = {
  pid: number;
  nonce: string;
  startedAt: string;
  database: string;
};

function processExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function readLock(path: string): LockPayload | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockPayload;
  } catch {
    return null;
  }
}

export function acquireDataLock(url = databaseUrl()): DataLock {
  const dir = dataDirectory(url);
  mkdirSync(dir, { recursive: true });
  const database = databaseFilePath(url);
  const path = resolve(dir, `${basename(database)}.lock`);
  const payload: LockPayload = {
    pid: process.pid,
    nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date().toISOString(),
    database,
  };

  for (;;) {
    let fd: number | null = null;
    try {
      fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify(payload, null, 2));
      closeSync(fd);
      fd = null;
      return {
        path,
        release() {
          const current = readLock(path);
          if (current?.pid === payload.pid && current.nonce === payload.nonce) {
            try {
              unlinkSync(path);
            } catch {
              /* Best effort: a stale lock can be safely reclaimed on the next start. */
            }
          }
        },
      };
    } catch (error) {
      if (fd !== null) closeSync(fd);
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      const existing = readLock(path);
      if (!existing || processExists(existing.pid)) {
        throw new AppError(
          'DATA_DIR_LOCKED',
          '数据目录正在被另一个One2Novel进程使用，请关闭该进程后再启动。',
          409,
        );
      }
      try {
        unlinkSync(path);
      } catch {
        throw new AppError('DATA_DIR_LOCKED', '数据目录锁无法确认或回收，请手动检查。', 409);
      }
    }
  }
}
