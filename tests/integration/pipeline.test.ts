import { loadSnapshot, pack } from '../../apps/server/src/story-state/snapshot.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createDb, initializeDb, type DB } from '../../apps/server/src/platform/db.js';
import { seedConfig, saveConfig } from '../../apps/server/src/orchestrator/config.js';
import { Orchestrator } from '../../apps/server/src/orchestrator/service.js';
import { uuid, hash, normalize, bodyLength } from '../../apps/server/src/platform/core.js';
import { FakeModel, testSettings } from '../fixtures/fake-model.js';
let db: DB, engine: Orchestrator, model: FakeModel, dir: string;
beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'one2novel-test-'));
  const file = resolve(dir, 'test.db'),
    sql = new Database(file);
  sql.exec(
    readFileSync(
      resolve('apps/server/prisma/migrations/20260905000000_initial/migration.sql'),
      'utf8',
    ),
  );
  sql.close();
  db = createDb(`file:${file.replaceAll('\\', '/')}`);
  await initializeDb(db);
  await seedConfig(db);
  await saveConfig(db, 'models', testSettings, 0);
  model = new FakeModel();
  engine = new Orchestrator(db, model);
});
afterEach(async () => {
  await engine.stop();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
async function project(targetCount = 3) {
  return db.project.create({
    data: {
      id: uuid(),
      title: '渡口',
      idea: '钟表里藏着来信',
      genre: '悬疑',
      requirements: { must: [], avoid: [], preferences: [] },
      targetCount,
      targetLength: 500,
    },
  });
}
async function ready(targetCount = 3) {
  const p = await project(targetCount);
  const j = await engine.startJob(p.id, 'OPENING', p.revision, uuid());
  await engine.tick();
  const completed = await db.job.findUniqueOrThrow({ where: { id: j.id } });
  expect(completed.status, completed.errorMessage || '').toBe('SUCCEEDED');
  const refs = completed.artifactRefs as Record<string, string>;
  await engine.confirmOpening(p.id, refs.OPENING, 0, []);
  return db.project.findUniqueOrThrow({ where: { id: p.id } });
}
async function write(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const j = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid(), { mode: 'GENERATE' });
  await engine.tick();
  return db.job.findUniqueOrThrow({ where: { id: j.id } });
}
describe('可靠章节生产', () => {
  it('第20章物理Checkpoint与历史支线隔离，21章冷回放正确', async () => {
    const p = await ready(25);
    for (let i = 0; i < 21; i++) {
      const j = await write(p.id);
      expect(j.status, j.errorMessage || '').toBe('SUCCEEDED');
    }
    const head = await db.project.findUniqueOrThrow({ where: { id: p.id } }),
      old21 = head.headSnapshotId!;
    expect(await db.snapshot.count({ where: { checkpoint: { not: null } } })).toBe(2);
    expect((await loadSnapshot(db, old21, p.id)).state.chapterNo).toBe(21);
    const old20 = await db.snapshot.findFirstOrThrow({ where: { projectId: p.id, chapterNo: 20 } });
    await db.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: p.id },
        data: {
          headChapter: 19,
          headSnapshotId: old20.parentId,
          chainEpoch: { increment: 1 },
          revision: { increment: 1 },
        },
      });
      await tx.chapter.updateMany({
        where: { projectId: p.id, number: { gte: 20 } },
        data: { activeContentId: null, status: 'STALE' },
      });
    });
    expect((await write(p.id)).status).toBe('SUCCEEDED');
    const newHead = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(newHead.headSnapshotId).not.toBe(old20.id);
    const replay = await loadSnapshot(db, newHead.headSnapshotId!, p.id);
    expect(replay.ancestorIds).not.toContain(old20.id);
    expect(replay.ancestorIds).not.toContain(old21);
    expect((await loadSnapshot(db, old21, p.id)).state.chapterNo).toBe(21);
  }, 30000);
  it('从空库创建、确认、连续提交两章；事实只来自当前父链', async () => {
    const p = await ready();
    const first = await write(p.id);
    expect(first.status, first.errorMessage || '').toBe('SUCCEEDED');
    const second = await write(p.id);
    expect(second.status, second.errorMessage || '').toBe('SUCCEEDED');
    const final = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(final.headChapter).toBe(2);
    const s = await loadSnapshot(db, final.headSnapshotId!, p.id);
    expect(s.state.chapterNo).toBe(2);
    expect(Object.values(s.state.characters)[0].conditions).toEqual(['已检查第2章旧钟']);
    expect(await db.commitReceipt.count()).toBe(2);
    expect(await db.snapshot.count({ where: { checkpoint: { not: null } } })).toBe(1);
    expect(await db.activeCommand.count()).toBe(0);
    const secondContext = model.calls.filter((c) => c.prompt === 'production.write')[1].input as {
      state: { chapterNo: number };
    };
    expect(secondContext.state.chapterNo).toBe(1);
  });
  it('相同请求幂等，不同命令互斥', async () => {
    const p = await ready(),
      key = uuid();
    const a = await engine.startJob(p.id, 'CHAPTER', p.revision, key);
    const b = await engine.startJob(p.id, 'CHAPTER', p.revision, key);
    expect(a.id).toBe(b.id);
    await expect(engine.startJob(p.id, 'CHAPTER', p.revision, uuid())).rejects.toMatchObject({
      code: 'PROJECT_BUSY',
    });
    await expect(
      engine.startJob(p.id, 'CHAPTER', p.revision, key, { mode: 'AUDIT_DRAFT' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('审核MINOR耗尽修复，不提交或跳章', async () => {
    const p = await ready();
    model.minor = true;
    const j = await write(p.id);
    expect(j.status).toBe('FAILED');
    expect(j.bodyRepairs).toBe(2);
    expect(j.errorCode).toBe('BODY_REPAIR_EXHAUSTED');
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    expect(await db.content.count()).toBe(3);
    expect(await db.commitReceipt.count()).toBe(0);
  });
  it('抽取异常保留正文候选，恢复后不重新生成', async () => {
    const p = await ready();
    model.failAt = 'state.extract';
    const j = await write(p.id);
    expect(j.status).toBe('FAILED');
    expect(await db.content.count()).toBe(1);
    model.failAt = null;
    await engine.retry(j.id, j.revision);
    await engine.tick();
    expect((await db.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe('SUCCEEDED');
    expect(model.calls.filter((c) => c.prompt === 'production.write')).toHaveLength(1);
  });
  it('进程恢复不会自动请求模型，需显式恢复', async () => {
    const p = await ready(),
      j = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid());
    const calls = model.calls.length;
    await engine.recover();
    await engine.tick();
    expect(model.calls.length).toBe(calls);
    const interrupted = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(interrupted.status).toBe('INTERRUPTED');
    await engine.retry(j.id, interrupted.revision);
    await engine.tick();
    expect((await db.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe('SUCCEEDED');
  });
  it('取消排队任务不发请求，不改变head', async () => {
    const p = await ready(),
      j = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid());
    await engine.cancel(j.id);
    const calls = model.calls.length;
    await engine.tick();
    expect(model.calls.length).toBe(calls);
    expect(await db.activeCommand.count()).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBe(
      p.headSnapshotId,
    );
  });
  it('损坏Checkpoint无法恢复，不用模型修理', async () => {
    const p = await ready();
    await db.snapshot.update({ where: { id: p.headSnapshotId! }, data: { stateHash: 'bad' } });
    await expect(loadSnapshot(db, p.headSnapshotId!, p.id)).rejects.toMatchObject({
      code: 'STATE_CORRUPTED',
    });
  });
  it('原子事务中间失败所有正式写入回滚', async () => {
    const p = await ready();
    await db.$executeRawUnsafe(
      "CREATE TRIGGER fail_commit BEFORE INSERT ON CommitReceipt BEGIN SELECT RAISE(ABORT, 'fault injection'); END",
    );
    const j = await write(p.id);
    expect(j.status).toBe('FAILED');
    expect(await db.delta.count()).toBe(0);
    expect(await db.storyEvent.count()).toBe(0);
    expect(await db.snapshot.count()).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    expect(await db.content.count()).toBe(1);
  });
});
it('规范化、Unicode和哈希规则稳定', () => {
  expect(normalize('\uFEFF A\r\ne\u0301\r\n\r\n\r\n😀 ')).toBe('A\né\n\n😀');
  expect(bodyLength('a 😀\n')).toBe(2);
  expect(hash({ b: 1, a: 2 })).toBe(hash({ a: 2, b: 1 }));
  expect(() => normalize('a\0b')).toThrow();
});
