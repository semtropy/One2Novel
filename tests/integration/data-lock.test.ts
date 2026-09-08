import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { acquireDataLock } from '../../apps/server/src/platform/data-lock.js';
import { databaseFilePath } from '../../apps/server/src/platform/db.js';

const dirs: string[] = [];

function dbUrl(name = 'one2novel.db') {
  const dir = mkdtempSync(resolve(tmpdir(), 'one2novel-lock-'));
  dirs.push(dir);
  return `file:${resolve(dir, name).replaceAll('\\', '/')}`;
}

function lockPath(url: string) {
  const db = databaseFilePath(url);
  return resolve(resolve(db, '..'), `${basename(db)}.lock`);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('数据目录单实例保护', () => {
  it('同一个数据库路径只能被一个进程持有', () => {
    const url = dbUrl();
    const lock = acquireDataLock(url);
    try {
      expect(() => acquireDataLock(url)).toThrow('数据目录正在被另一个One2Novel进程使用');
    } finally {
      lock.release();
    }
    expect(existsSync(lock.path)).toBe(false);
  });

  it('不同数据目录互不影响', () => {
    const first = acquireDataLock(dbUrl('first.db'));
    const second = acquireDataLock(dbUrl('second.db'));
    try {
      expect(first.path).not.toBe(second.path);
    } finally {
      first.release();
      second.release();
    }
  });

  it('确认原持有进程已退出后可回收旧锁', () => {
    const url = dbUrl();
    const path = lockPath(url);
    writeFileSync(
      path,
      JSON.stringify({
        pid: 99999999,
        nonce: 'stale',
        startedAt: '2026-09-06T00:00:00.000Z',
        database: databaseFilePath(url),
      }),
    );
    const lock = acquireDataLock(url);
    try {
      expect(lock.path).toBe(path);
      expect(existsSync(path)).toBe(true);
    } finally {
      lock.release();
    }
    expect(existsSync(path)).toBe(false);
  });
});
