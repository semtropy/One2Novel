import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createDb, initializeDb, type DB } from '../../apps/server/src/platform/db.js';
import { seedConfig, saveConfig } from '../../apps/server/src/orchestrator/config.js';
import { Orchestrator } from '../../apps/server/src/orchestrator/service.js';
import {
  savePlanCandidates,
  listPlans,
  readPlan,
} from '../../apps/server/src/planning/versions.js';
import { FakeModel, testSettings } from '../fixtures/fake-model.js';
import { migrateTestDb } from '../fixtures/migrate.js';
import { uuid, AppError, hash } from '../../apps/server/src/platform/core.js';
let db: DB, engine: Orchestrator, model: FakeModel, dir: string, projectId: string;
beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'one2novel-plans-'));
  const file = resolve(dir, 'test.db'),
    native = new Database(file);
  migrateTestDb(native);
  native.close();
  db = createDb(`file:${file.replaceAll('\\', '/')}`);
  await initializeDb(db);
  await seedConfig(db);
  await saveConfig(db, 'models', testSettings, 0);
  model = new FakeModel();
  engine = new Orchestrator(db, model);
  const p = await db.project.create({
    data: {
      id: uuid(),
      title: '计划测试',
      idea: '旧信',
      genre: '悬疑',
      requirements: { must: [], avoid: [], preferences: [] },
      targetCount: 3,
      targetLength: 500,
    },
  });
  projectId = p.id;
  const j = await engine.startJob(p.id, 'OPENING', 0, uuid());
  await engine.tick();
  const done = await db.job.findUniqueOrThrow({ where: { id: j.id } });
  await engine.confirmOpening(p.id, (done.artifactRefs as any).OPENING, 0, []);
});
afterEach(async () => {
  await engine.stop();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
const project = () => db.project.findUniqueOrThrow({ where: { id: projectId } });
async function write() {
  const p = await project(),
    j = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid(), { mode: 'GENERATE' });
  await engine.tick();
  return db.job.findUniqueOrThrow({ where: { id: j.id } });
}
async function editBook() {
  const p = await project(),
    row = (await listPlans(db, p.id)).find((r) => r.level === 'BOOK' && r.status === 'ACTIVE')!;
  const payload = readPlan(row);
  payload.summary = '新方向';
  return savePlanCandidates(db, p.id, p.revision, [payload]);
}
async function activate(id: string, key = uuid()) {
  const p = await project(),
    j = await engine.startJob(p.id, 'PLAN_ACTIVATE', p.revision, key, { versionIds: [id] });
  await engine.tick();
  return db.job.findUniqueOrThrow({ where: { id: j.id } });
}
it('全书候选不改变活动版本；启用幂等且后续生产读取新方向', async () => {
  const before = await project(),
    saved = await editBook();
  expect((await project()).planRevision).toBe(0);
  const key = uuid();
  const queued = await engine.startJob(projectId, 'PLAN_ACTIVATE', saved.revision, key, {
    versionIds: [saved.versions[0].id],
  });
  expect(
    (
      await engine.startJob(projectId, 'PLAN_ACTIVATE', saved.revision, key, {
        versionIds: [saved.versions[0].id],
      })
    ).id,
  ).toBe(queued.id);
  await engine.tick();
  expect((await db.job.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe('SUCCEEDED');
  expect((await project()).headSnapshotId).toBe(before.headSnapshotId);
  expect((await project()).planRevision).toBe(1);
  let summary = '';
  model.beforeCall = async (r) => {
    if (r.prompt === 'planning.rolling') summary = (r.input as any).book.summary;
  };
  expect((await write()).status).toBe('SUCCEEDED');
  expect(summary).toBe('新方向');
});
it('父更换使未来子计划失效，完成章的计划和旧父版本保留', async () => {
  expect((await write()).status).toBe('SUCCEEDED');
  const before = await listPlans(db, projectId),
    first = before.find((r) => r.level === 'CHAPTER' && r.rangeStart === 1)!;
  const saved = await editBook();
  expect((await activate(saved.versions[0].id)).status).toBe('SUCCEEDED');
  expect((await db.planVersion.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
    'ACTIVE',
  );
  expect(
    (await listPlans(db, projectId))
      .filter((r) => r.level === 'CHAPTER' && r.rangeStart > 1)
      .every((r) => r.status === 'STALE'),
  ).toBe(true);
  await expect(
    savePlanCandidates(db, projectId, (await project()).revision, [readPlan(first)]),
  ).rejects.toThrow();
  expect((await write()).status).toBe('SUCCEEDED');
});
it('校验失败或候选前提错误不启用；旧任务不能套用新计划恢复', async () => {
  const p = await project(),
    old = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid(), { mode: 'GENERATE' });
  await engine.recover();
  const saved = await editBook();
  model.beforeCall = async (r) => {
    if (r.prompt === 'planning.validate') throw new AppError('PLAN_INVALID', '模拟冲突');
  };
  expect((await activate(saved.versions[0].id)).status).toBe('FAILED');
  expect((await project()).planRevision).toBe(0);
  model.beforeCall = undefined;
  expect((await activate(saved.versions[0].id)).status).toBe('SUCCEEDED');
  await expect(
    engine.retry(old.id, (await db.job.findUniqueOrThrow({ where: { id: old.id } })).revision),
  ).rejects.toMatchObject({ code: 'STALE_INPUT' });
});
it('启用事务失败回滚状态与revision；同层空洞和跨项目父引用拒绝', async () => {
  const saved = await editBook();
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_plan BEFORE UPDATE ON Project WHEN NEW.planRevision > OLD.planRevision BEGIN SELECT RAISE(ABORT, 'failure'); END`,
  );
  expect((await activate(saved.versions[0].id)).status).toBe('FAILED');
  expect((await project()).planRevision).toBe(0);
  expect(
    (await db.planVersion.findUniqueOrThrow({ where: { id: saved.versions[0].id } })).status,
  ).toBe('CANDIDATE');
  await db.$executeRawUnsafe('DROP TRIGGER fail_plan');
  expect((await write()).status).toBe('SUCCEEDED');
  const chapter = (await listPlans(db, projectId)).find(
    (r) => r.level === 'CHAPTER' && r.rangeStart === 2,
  )!;
  const bad = readPlan(chapter);
  bad.parentVersionId = uuid();
  await expect(
    savePlanCandidates(db, projectId, (await project()).revision, [bad]),
  ).rejects.toThrow();
  await expect(
    savePlanCandidates(db, projectId, (await project()).revision, [readPlan(chapter)], {
      siblings: true,
    }),
  ).rejects.toThrow();
});
it('提交再次验证具体计划hash，篡改不能借模型PASS提交', async () => {
  let changed = false;
  model.beforeCall = async (r) => {
    if (r.prompt === 'state.validate' && !changed) {
      changed = true;
      const row = (await listPlans(db, projectId)).find(
        (v) => v.level === 'CHAPTER' && v.rangeStart === 1,
      )!;
      const payload = readPlan(row);
      payload.summary = '篡改';
      await db.planVersion.update({
        where: { id: row.id },
        data: { payload: payload as any, hash: hash(payload) },
      });
    }
  };
  expect((await write()).status).toBe('FAILED');
  expect((await project()).headChapter).toBe(0);
});
