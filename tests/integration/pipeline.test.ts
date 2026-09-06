import { loadSnapshot, pack } from '../../apps/server/src/story-state/snapshot.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import { createApp } from '../../apps/server/src/http.js';
import { createDb, initializeDb, type DB } from '../../apps/server/src/platform/db.js';
import { seedConfig, saveConfig } from '../../apps/server/src/orchestrator/config.js';
import { Orchestrator } from '../../apps/server/src/orchestrator/service.js';
import { uuid, hash, normalize, bodyLength } from '../../apps/server/src/platform/core.js';
import { FakeModel, testSettings } from '../fixtures/fake-model.js';
import { migrateTestDb } from '../fixtures/migrate.js';
let db: DB, engine: Orchestrator, model: FakeModel, dir: string;
beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'one2novel-test-'));
  const file = resolve(dir, 'test.db'),
    sql = new Database(file);
  migrateTestDb(sql);
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

async function batch(projectId: string, count: number, key = uuid()) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  return engine.startJob(p.id, 'BATCH', p.revision, key, { mode: 'GENERATE', count });
}
const getJob = (id: string) => db.job.findUniqueOrThrow({ where: { id } });
async function drainBatch(id: string) {
  for (let i = 0; i < 25; i++) {
    const j = await getJob(id);
    if (!['QUEUED', 'RUNNING'].includes(j.status)) return j;
    await engine.tick();
  }
  throw new Error('Batch did not stop within bounded ticks');
}

describe('批次共享串行事实链', () => {
  it('HTTP拒绝超范围及多章草稿；预算耗尽只对当前子章显式增额后恢复', async () => {
    const p = await ready(),
      server = createServer(createApp(db, engine, model));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:7456',
          'Idempotency-Key': uuid(),
        },
        body: JSON.stringify(body),
      });
    try {
      for (const count of [0, 11])
        expect(
          (
            await post(`/projects/${p.id}/production-runs`, {
              expectedRevision: p.revision,
              mode: 'GENERATE',
              count,
            })
          ).status,
        ).toBe(422);
      expect(
        (
          await post(`/projects/${p.id}/production-runs`, {
            expectedRevision: p.revision,
            mode: 'AUDIT_DRAFT',
            draftRevision: 1,
            count: 2,
          })
        ).status,
      ).toBe(422);
      const response = await post(`/projects/${p.id}/production-runs`, {
        expectedRevision: p.revision,
        mode: 'GENERATE',
        count: 2,
      });
      expect(response.status).toBe(202);
      const { data: parent } = await response.json();
      await engine.tick();
      const child = await db.job.findFirstOrThrow({ where: { parentId: parent.id } });
      await db.job.update({ where: { id: child.id }, data: { httpLimit: 1 } });
      expect((await drainBatch(parent.id)).status).toBe('PAUSED');
      const paused = await getJob(parent.id),
        failed = await getJob(child.id);
      expect(failed.httpUsed).toBe(1);
      expect(failed.errorCode).toBe('BUDGET_EXHAUSTED');
      await expect(engine.retry(parent.id, paused.revision)).rejects.toMatchObject({
        code: 'BUDGET_EXHAUSTED',
      });
      expect(await db.activeCommand.count()).toBe(0);
      const limits = { httpLimit: 40, bodyRepairLimit: 2, deltaRepairLimit: 2 };
      expect(
        (await post(`/jobs/${parent.id}/budget`, { expectedRevision: paused.revision, ...limits }))
          .status,
      ).toBe(422);
      expect(
        (await post(`/jobs/${child.id}/budget`, { expectedRevision: failed.revision, ...limits }))
          .status,
      ).toBe(200);
      expect((await getJob(child.id)).httpUsed).toBe(1);
      expect(
        (await post(`/jobs/${parent.id}/retry`, { expectedRevision: paused.revision })).status,
      ).toBe(202);
      expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });

  it('子任务运行中进程中断，父子同时可见中断，恢复已有候选而不再写正文', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    model.failAt = 'state.extract';
    await drainBatch(parent.id);
    const child = await db.job.findFirstOrThrow({ where: { parentId: parent.id } });
    // Reconstruct persisted RUNNING state at the same extraction boundary as an abrupt process exit.
    await db.job.updateMany({
      where: { id: { in: [parent.id, child.id] } },
      data: { status: 'RUNNING' },
    });
    await engine.recover();
    expect((await getJob(parent.id)).status).toBe('INTERRUPTED');
    expect((await getJob(child.id)).status).toBe('INTERRUPTED');
    const calls = model.calls.length;
    await engine.tick();
    expect(model.calls).toHaveLength(calls);
    model.failAt = null;
    await engine.retry(parent.id, (await getJob(parent.id)).revision);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    expect(model.calls.filter((c) => c.prompt === 'production.write')).toHaveLength(2);
    expect(await db.commitReceipt.count()).toBe(2);
  });

  it('批次最多10章；每章独立提交且基础连续；达到目标不自动完结', async () => {
    const p = await ready(10);
    await expect(batch(p.id, 11)).rejects.toMatchObject({ code: 'INVALID_BATCH' });
    const parent = await batch(p.id, 10);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    const children = await db.job.findMany({
      where: { parentId: parent.id },
      orderBy: { number: 'asc' },
    });
    expect(children.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(children.every((c) => c.status === 'SUCCEEDED')).toBe(true);
    expect(await db.commitReceipt.count()).toBe(10);
    const final = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(final.headChapter).toBe(10);
    expect(final.status).toBe('WRITING');
    expect((await loadSnapshot(db, final.headSnapshotId!, p.id)).state.chapterNo).toBe(10);
    expect(await db.activeCommand.count()).toBe(0);
  }, 30000);

  it('相同批次幂等，章间父锁仍在，不能插入另一个生产命令', async () => {
    const p = await ready(),
      key = uuid();
    const parent = await batch(p.id, 2, key);
    expect((await batch(p.id, 2, key)).id).toBe(parent.id);
    await expect(batch(p.id, 3, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await engine.tick();
    await engine.tick();
    expect((await getJob(parent.id)).status).toBe('QUEUED');
    expect((await db.activeCommand.findUniqueOrThrow({ where: { projectId: p.id } })).jobId).toBe(
      parent.id,
    );
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    await expect(engine.startJob(p.id, 'CHAPTER', current.revision, uuid())).rejects.toMatchObject({
      code: 'PROJECT_BUSY',
    });
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
  });

  it('第2章MINOR修复耗尽，子FAILED父PAUSED，不创建第3章；恢复同一候选和计数', async () => {
    const p = await ready(),
      parent = await batch(p.id, 3);
    await engine.tick();
    await engine.tick();
    model.minor = true;
    const paused = await drainBatch(parent.id);
    expect(paused.status).toBe('PAUSED');
    expect(await db.job.count({ where: { parentId: parent.id, number: 3 } })).toBe(0);
    const failed = await db.job.findFirstOrThrow({ where: { parentId: parent.id, number: 2 } });
    expect(failed.status).toBe('FAILED');
    expect(failed.bodyRepairs).toBe(2);
    expect(await db.activeCommand.count()).toBe(0);
    await expect(engine.retry(failed.id, failed.revision)).rejects.toMatchObject({
      code: 'BATCH_CONTROL_REQUIRED',
    });
    await expect(engine.cancel(failed.id)).rejects.toMatchObject({
      code: 'BATCH_CONTROL_REQUIRED',
    });
    model.minor = false;
    const writes = model.calls.filter((c) => c.prompt === 'production.write').length;
    await engine.retry(parent.id, paused.revision);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    expect((await getJob(failed.id)).httpUsed).toBeGreaterThan(failed.httpUsed);
    expect((await getJob(failed.id)).bodyRepairs).toBe(2);
    expect(model.calls.filter((c) => c.prompt === 'production.write')).toHaveLength(writes + 1);
    expect(await db.commitReceipt.count()).toBe(3);
  });

  it('本章后暂停完成当前提交，重启后显式恢复下一章，冻结配置不随后台变化', async () => {
    const p = await ready(),
      parent = await batch(p.id, 3);
    model.beforeCall = async (r) => {
      if (r.prompt !== 'state.validate') return;
      model.beforeCall = undefined;
      const j = await getJob(parent.id);
      await engine.pause(j.id, j.revision);
    };
    const paused = await drainBatch(parent.id);
    expect(paused.status).toBe('PAUSED');
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(1);
    expect(await db.job.count({ where: { parentId: parent.id } })).toBe(1);
    await engine.recover();
    const calls = model.calls.length;
    await engine.tick();
    expect(model.calls).toHaveLength(calls);
    await saveConfig(
      db,
      'models',
      {
        ...testSettings,
        profiles: testSettings.profiles.map((p) => ({ ...p, model: 'changed-after-pause' })),
      },
      1,
    );
    await engine.retry(parent.id, (await getJob(parent.id)).revision);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    const children = await db.job.findMany({ where: { parentId: parent.id } });
    expect(children.every((c) => hash(c.config) === hash(parent.config))).toBe(true);
  });

  it('排队时暂停不生成子任务；已安排的章节会完成后暂停', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2),
      calls = model.calls.length;
    const paused = await engine.pause(parent.id, parent.revision);
    expect(paused.status).toBe('PAUSED');
    await engine.tick();
    expect(model.calls).toHaveLength(calls);
    await engine.retry(parent.id, paused.revision);
    await engine.tick();
    const running = await getJob(parent.id);
    await engine.pause(parent.id, running.revision);
    expect((await drainBatch(parent.id)).status).toBe('PAUSED');
    expect(await db.commitReceipt.count()).toBe(1);
  });

  it('取消先于最终提交：父子取消、无事实写入，取消后禁止恢复', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    model.beforeCall = async (r) => {
      if (r.prompt === 'state.validate') await engine.cancel(parent.id);
    };
    expect((await drainBatch(parent.id)).status).toBe('CANCELLED');
    const child = await db.job.findFirstOrThrow({ where: { parentId: parent.id } });
    expect(child.status).toBe('CANCELLED');
    expect(await db.commitReceipt.count()).toBe(0);
    expect(await db.delta.count()).toBe(0);
    expect(await db.activeCommand.count()).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBe(
      p.headSnapshotId,
    );
    await expect(engine.retry(parent.id, (await getJob(parent.id)).revision)).rejects.toMatchObject(
      { code: 'INVALID_JOB_STATE' },
    );
  });

  it('章间取消保留前章，已完成批次取消返回SUCCEEDED', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    await engine.tick();
    await engine.tick();
    expect((await engine.cancel(parent.id)).status).toBe('CANCELLED');
    await engine.tick();
    expect(await db.commitReceipt.count()).toBe(1);
    const next = await batch(p.id, 2);
    expect((await drainBatch(next.id)).status).toBe('SUCCEEDED');
    expect((await engine.cancel(next.id)).status).toBe('SUCCEEDED');
    expect(await db.commitReceipt.count()).toBe(3);
  });

  it('提交后调度前进程退出，恢复跳过已提交章；重写改变epoch则拒绝旧批次', async () => {
    const p = await ready(),
      parent = await batch(p.id, 3);
    await engine.tick();
    await engine.tick();
    await engine.recover();
    const interrupted = await getJob(parent.id),
      calls = model.calls.length;
    expect(interrupted.status).toBe('INTERRUPTED');
    await engine.tick();
    expect(model.calls).toHaveLength(calls);
    await engine.retry(parent.id, interrupted.revision);
    await engine.tick();
    await engine.tick();
    expect(await db.commitReceipt.count()).toBe(2);
    const j = await getJob(parent.id);
    await engine.pause(parent.id, j.revision);
    await db.project.update({ where: { id: p.id }, data: { chainEpoch: { increment: 1 } } });
    await expect(engine.retry(parent.id, (await getJob(parent.id)).revision)).rejects.toMatchObject(
      { code: 'STALE_INPUT' },
    );
    expect(await db.activeCommand.count()).toBe(0);
  });

  it('子章提交事务故障同时回滚父进度，恢复只提交一次', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    await db.$executeRawUnsafe(
      "CREATE TRIGGER fail_parent BEFORE UPDATE ON Job WHEN NEW.kind = 'BATCH' AND NEW.stage = 'NEXT' BEGIN SELECT RAISE(ABORT, 'parent fault'); END",
    );
    expect((await drainBatch(parent.id)).status).toBe('PAUSED');
    expect(await db.commitReceipt.count()).toBe(0);
    expect(await db.delta.count()).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    await db.$executeRawUnsafe('DROP TRIGGER fail_parent');
    await engine.retry(parent.id, (await getJob(parent.id)).revision);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    expect(await db.commitReceipt.count()).toBe(2);
  });
});
