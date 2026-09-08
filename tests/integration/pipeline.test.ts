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
import { jobRecovery } from '../../apps/server/src/orchestrator/recovery.js';
import { AppError } from '../../apps/server/src/platform/core.js';
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
  it('重建开篇保留旧命题观察与草稿，旧任务不能恢复，新章只读取新State 0', async () => {
    const { p, openingId, payload } = await candidate();
    const character = Object.keys(payload.state.characters)[0],
      prop = uuid(),
      version = uuid();
    const event = payload.initialEvents[0].id;
    const evidence = {
      origin: 'CANON',
      sourceVersionId: payload.state.canonVersionId,
      span: null,
      assertion: 'OBSERVED_ACTION',
      note: '开篇已知',
    };
    payload.state.propositions[prop] = {
      id: prop,
      subjectId: character,
      predicate: '持有线索',
      object: true,
      currentVersionId: version,
    };
    payload.propositionVersions = [
      {
        id: version,
        propositionId: prop,
        truth: 'TRUE',
        changeKind: 'INITIAL',
        effectiveAtEventId: { kind: 'INITIAL', id: event },
        recordedAtEventId: { kind: 'INITIAL', id: event },
        supersedesVersionId: null,
        correctsVersionId: null,
        evidence: [evidence],
      },
    ];
    payload.state.knowledge = [
      {
        characterId: character,
        propositionId: prop,
        propositionVersionId: version,
        learnedAtEventId: { kind: 'INITIAL', id: event },
        attitude: 'KNOWS',
        evidence: [evidence],
      },
    ];
    await db.artifact.update({ where: { id: openingId }, data: { payload, hash: hash(payload) } });
    const original = await engine.confirmOpening(p.id, openingId, 0, []);
    const oldState = await loadSnapshot(db, original.headSnapshotId!, p.id);
    const oldJob = await engine.startJob(p.id, 'CHAPTER', original.revision, uuid(), {
      mode: 'GENERATE',
    });
    await engine.recover();
    const interrupted = await db.job.findUniqueOrThrow({ where: { id: oldJob.id } });
    await db.chapter.update({
      where: { projectId_number: { projectId: p.id, number: 1 } },
      data: { draft: '保留人工草稿', draftRevision: 1 },
    });
    const source = await db.artifact.findUniqueOrThrow({ where: { id: original.openingId! } });
    const changed = structuredClone(source.payload) as any;
    changed.propositionVersions[0].truth = 'FALSE';
    changed.state.knowledge[0].attitude = 'REJECTS';
    const saved = await engine.saveOpeningCandidate(p.id, original.revision, changed);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBe(
      original.headSnapshotId,
    );
    const next = await engine.confirmOpening(p.id, saved.id, original.revision + 1, []);
    expect(next.chainEpoch).toBe(original.chainEpoch + 1);
    expect(next.headSnapshotId).not.toBe(original.headSnapshotId);
    const state = await loadSnapshot(db, next.headSnapshotId!, p.id);
    expect(state.state.canonVersionId).not.toBe(oldState.state.canonVersionId);
    const newVersion = state.state.propositions[prop].currentVersionId!;
    expect(newVersion).not.toBe(version);
    expect(state.versions[newVersion].truth).toBe('FALSE');
    expect(state.state.knowledge[0].propositionVersionId).toBe(newVersion);
    expect((await loadSnapshot(db, original.headSnapshotId!, p.id)).state).toEqual(oldState.state);
    expect((await db.chapter.findFirstOrThrow()).draft).toBe('保留人工草稿');
    await expect(engine.retry(oldJob.id, interrupted.revision)).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    expect((await write(p.id)).status).toBe('SUCCEEDED');
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(
      (await db.snapshot.findUniqueOrThrow({ where: { id: current.headSnapshotId! } })).parentId,
    ).toBe(next.headSnapshotId);
  });
  it('重建确认失败不改变旧开篇，过期候选及活动生产均拒绝', async () => {
    const p = await ready();
    const source = await db.artifact.findUniqueOrThrow({ where: { id: p.openingId! } });
    const saved = await engine.saveOpeningCandidate(p.id, p.revision, source.payload);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_rebuild BEFORE INSERT ON Artifact
      WHEN NEW.kind = 'OPENING_CONFIRMATION' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    await expect(engine.confirmOpening(p.id, saved.id, p.revision + 1, [])).rejects.toThrow();
    expect(await db.snapshot.count()).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBe(
      p.headSnapshotId,
    );
    await db.$executeRawUnsafe('DROP TRIGGER reject_rebuild');
    const next = await engine.confirmOpening(p.id, saved.id, p.revision + 1, []);
    await expect(engine.confirmOpening(p.id, saved.id, next.revision, [])).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    const active = await db.artifact.findUniqueOrThrow({ where: { id: next.openingId! } });
    await engine.startJob(p.id, 'CHAPTER', next.revision, uuid(), { mode: 'GENERATE' });
    await expect(
      engine.saveOpeningCandidate(p.id, next.revision, active.payload),
    ).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
  });
  it('HTTP已有正文须从第一章重写后才能重建，保留历史正文并返回正式开书版本', async () => {
    const p = await ready();
    expect((await write(p.id)).status).toBe('SUCCEEDED');
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    const source = await db.artifact.findUniqueOrThrow({ where: { id: p.openingId! } });
    const server = createServer(createApp(db, engine, model));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/projects/${p.id}`;
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:7456',
          'Idempotency-Key': uuid(),
        },
        body: JSON.stringify(body),
      });
    try {
      const rejected = await post('/opening-candidates', {
        expectedRevision: current.revision,
        payload: source.payload,
      });
      expect(rejected.status).toBe(409);
      expect((await rejected.json()).error.code).toBe('REWRITE_REQUIRED');
      const preview = (await (await fetch(base + '/rewrite-preview?fromChapter=1')).json()).data;
      const reverted = (await (await post('/rewrites', preview)).json()).data;
      const saved = (
        await (
          await post('/opening-candidates', {
            expectedRevision: reverted.revision,
            payload: source.payload,
          })
        ).json()
      ).data;
      const response = await post('/opening-confirmations', {
        openingId: saved.id,
        expectedRevision: reverted.revision + 1,
        acknowledgedWarnings: [],
      });
      expect(response.status).toBe(200);
      const rebuilt = (await response.json()).data;
      expect(rebuilt.headSnapshotId).not.toBe(p.headSnapshotId);
      expect((await db.chapter.findFirstOrThrow()).activeContentId).toBeNull();
      expect(await db.content.count()).toBeGreaterThan(0);
      // The active opening must remain available beyond the generic recent-artifact page.
      await db.artifact.createMany({
        data: Array.from({ length: 41 }, () => ({
          id: uuid(),
          projectId: p.id,
          kind: 'PLAN_REVIEW',
          payload: {},
          hash: hash({}),
        })),
      });
      const view = (await (await fetch(base)).json()).data;
      expect(view.artifacts.some((a: any) => a.id === rebuilt.openingId)).toBe(true);
      expect((await write(p.id)).status).toBe('SUCCEEDED');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  async function candidate(expected: unknown = 'ALIVE', importance = 'HARD') {
    const p = await project();
    const j = await engine.startJob(p.id, 'OPENING', 0, uuid());
    await engine.tick();
    const done = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    const openingId = (done.artifactRefs as any).OPENING;
    const source = await db.artifact.findUniqueOrThrow({ where: { id: openingId } });
    const payload = structuredClone(source.payload) as any;
    payload.book.assumptions = [
      {
        id: uuid(),
        selector: {
          collection: 'characters',
          key: Object.keys(payload.state.characters)[0],
          field: 'life',
        },
        operator: 'EQUALS',
        expected,
        importance,
        reason: '主角必须活着',
        basedOnSnapshotId: null,
      },
    ];
    await db.artifact.update({ where: { id: openingId }, data: { payload, hash: hash(payload) } });
    return { p, openingId, payload };
  }
  it('开书确认原子绑定前提与State 0，保留候选并可继续生产', async () => {
    const { p, openingId, payload } = await candidate();
    const confirmed = await engine.confirmOpening(p.id, openingId, 0, []);
    expect(confirmed.openingId).not.toBe(openingId);
    const saved = await db.artifact.findUniqueOrThrow({ where: { id: confirmed.openingId! } });
    expect((saved.payload as any).book.basedOnSnapshotId).toBe(confirmed.headSnapshotId);
    expect((saved.payload as any).book.assumptions[0].basedOnSnapshotId).toBe(
      confirmed.headSnapshotId,
    );
    expect((await db.artifact.findUniqueOrThrow({ where: { id: openingId } })).payload).toEqual(
      payload,
    );
    const review = await db.artifact.findFirstOrThrow({
      where: { projectId: p.id, kind: 'OPENING_CONFIRMATION' },
    });
    expect(review.payload).toMatchObject({
      sourceOpeningId: openingId,
      confirmedOpeningId: saved.id,
      snapshotId: confirmed.headSnapshotId,
      checks: [{ result: 'MATCH' }],
    });
    expect((await write(p.id)).status).toBe('SUCCEEDED');
  });
  it.each(['HARD', 'SOFT'])('开书拒绝%s不匹配前提且不写入事实', async (importance) => {
    const { p, openingId } = await candidate('DEAD', importance);
    await expect(engine.confirmOpening(p.id, openingId, 0, [])).rejects.toMatchObject({
      code: 'OPENING_ASSUMPTIONS',
    });
    expect(await db.snapshot.count()).toBe(0);
    expect(await db.propositionVersion.count()).toBe(0);
    expect(await db.chapter.count()).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).revision).toBe(0);
  });
  it('开书拒绝未知事实及外来快照引用', async () => {
    const { p, openingId, payload } = await candidate();
    payload.book.assumptions[0].selector.key = uuid();
    await db.artifact.update({ where: { id: openingId }, data: { payload, hash: hash(payload) } });
    await expect(engine.confirmOpening(p.id, openingId, 0, [])).rejects.toMatchObject({
      code: 'OPENING_ASSUMPTIONS',
    });
    payload.book.assumptions[0].basedOnSnapshotId = uuid();
    await db.artifact.update({ where: { id: openingId }, data: { payload, hash: hash(payload) } });
    await expect(engine.confirmOpening(p.id, openingId, 0, [])).rejects.toMatchObject({
      code: 'INVALID_ASSUMPTION',
    });
    expect(await db.snapshot.count()).toBe(0);
  });
  it('确认记录写入失败时回滚State 0、正式Book与章节', async () => {
    const { p, openingId } = await candidate();
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_confirmation BEFORE INSERT ON Artifact
      WHEN NEW.kind = 'OPENING_CONFIRMATION' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    await expect(engine.confirmOpening(p.id, openingId, 0, [])).rejects.toThrow();
    expect(await db.snapshot.count()).toBe(0);
    expect(await db.chapter.count()).toBe(0);
    expect(await db.propositionVersion.count()).toBe(0);
    expect(await db.artifact.count({ where: { kind: 'OPENING' } })).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBeNull();
  });
  it('WAITING_USER记录候选及根因，增额前拒绝原任务恢复，增额后不清零用量', async () => {
    const p = await ready();
    model.beforeCall = async (r) => {
      if (r.prompt === 'state.validate')
        throw new AppError('ILLEGAL_REVIVAL', '复活缺少既定规则许可');
    };
    const j = await write(p.id);
    expect(j.status).toBe('WAITING_USER');
    const info = await jobRecovery(db, j.id);
    expect(info.canResume).toBe(false);
    expect(info.needsBudget).toBe(true);
    expect(info.canRestart).toBe(true);
    expect(info.record).toMatchObject({
      code: 'ILLEGAL_REVIVAL',
      candidateId: (j.artifactRefs as any).CONTENT,
    });
    const calls = model.calls.length;
    await expect(engine.retry(j.id, j.revision)).rejects.toMatchObject({
      code: 'BODY_REPAIR_EXHAUSTED',
    });
    expect(model.calls.length).toBe(calls);
    expect(await db.activeCommand.count()).toBe(0);
    await db.job.update({
      where: { id: j.id },
      data: { bodyRepairLimit: 4, revision: { increment: 1 } },
    });
    model.beforeCall = undefined;
    const updated = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect((await jobRecovery(db, j.id)).canResume).toBe(true);
    await engine.retry(j.id, updated.revision);
    await engine.tick();
    const resumed = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(resumed.status, resumed.errorMessage || '').toBe('SUCCEEDED');
    expect(resumed.bodyRepairs).toBe(j.bodyRepairs);
    expect(resumed.httpUsed).toBeGreaterThan(j.httpUsed);
    expect(resumed.config).toEqual(j.config);
  });
  it('修改草稿后只允许新命令，原任务退役与新输入冻结原子且幂等', async () => {
    const p = await ready();
    const chapter = await db.chapter.findUniqueOrThrow({
      where: { projectId_number: { projectId: p.id, number: 1 } },
    });
    const text = '旧稿内容。'.repeat(85);
    await db.chapter.update({ where: { id: chapter.id }, data: { draft: text, draftRevision: 1 } });
    model.failAt = 'evaluation.run';
    const old = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid(), {
      mode: 'AUDIT_DRAFT',
      draftRevision: 1,
    });
    await engine.tick();
    const failed = await db.job.findUniqueOrThrow({ where: { id: old.id } });
    expect(failed.status).toBe('FAILED');
    const edited = '修订后的来信。'.repeat(60);
    await db.chapter.update({
      where: { id: chapter.id },
      data: { draft: edited, draftRevision: 2 },
    });
    await expect(engine.retry(old.id, failed.revision)).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    expect((await jobRecovery(db, old.id)).canResume).toBe(false);
    const restart = { id: old.id, revision: failed.revision },
      key = uuid();
    await db.$executeRawUnsafe(
      "CREATE TRIGGER fail_restart BEFORE INSERT ON JobEvent WHEN NEW.type = 'restarted' BEGIN SELECT RAISE(ABORT, 'restart fault'); END",
    );
    await expect(
      engine.startJob(
        p.id,
        'CHAPTER',
        p.revision,
        key,
        { mode: 'AUDIT_DRAFT', draftRevision: 2 },
        restart,
      ),
    ).rejects.toThrow();
    expect((await db.job.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('FAILED');
    expect(await db.activeCommand.count()).toBe(0);
    await db.$executeRawUnsafe('DROP TRIGGER fail_restart');
    const next = await engine.startJob(
      p.id,
      'CHAPTER',
      p.revision,
      key,
      { mode: 'AUDIT_DRAFT', draftRevision: 2 },
      restart,
    );
    const duplicate = await engine.startJob(
      p.id,
      'CHAPTER',
      p.revision,
      key,
      { mode: 'AUDIT_DRAFT', draftRevision: 2 },
      restart,
    );
    expect(duplicate.id).toBe(next.id);
    const retired = await db.job.findUniqueOrThrow({ where: { id: old.id } });
    expect(retired.status).toBe('CANCELLED');
    expect(retired.input).toEqual(failed.input);
    expect(retired.httpUsed).toBe(failed.httpUsed);
    expect((next.input as any).text).toBe(edited);
    expect(next.httpUsed).toBe(0);
    expect(await db.commitReceipt.count()).toBe(0);
    expect((await db.activeCommand.findUniqueOrThrow({ where: { projectId: p.id } })).jobId).toBe(
      next.id,
    );
    await expect(
      engine.startJob(p.id, 'CHAPTER', p.revision, key, { mode: 'GENERATE' }, restart),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('纠错冷回放保留旧命题和角色观察，不倒改State 0', async () => {
    const original = model.call.bind(model);
    model.flipFirstPropositionTruth = true;
    model.call = async (request) => {
      const result: any = await original(request);
      if (request.prompt === 'planning.book') {
        const id = uuid(),
          versionId = uuid();
        const characterId = Object.keys(result.state.characters)[0];
        const event = { kind: 'INITIAL', id: result.initialEvents[0].id };
        const evidence = [
          {
            origin: 'CANON',
            sourceVersionId: result.state.canonVersionId,
            span: null,
            assertion: 'EXPLICIT_NARRATION',
            note: '初始确认',
          },
        ];
        result.state.propositions[id] = {
          id,
          subjectId: characterId,
          predicate: '信来自钟匠',
          object: null,
          currentVersionId: versionId,
        };
        result.propositionVersions.push({
          id: versionId,
          propositionId: id,
          truth: 'TRUE',
          changeKind: 'INITIAL',
          effectiveAtEventId: event,
          recordedAtEventId: event,
          supersedesVersionId: null,
          correctsVersionId: null,
          evidence,
        });
        result.state.knowledge.push({
          characterId,
          propositionId: id,
          propositionVersionId: versionId,
          learnedAtEventId: event,
          attitude: 'KNOWS',
          evidence,
        });
      }
      if (request.prompt === 'state.extract') {
        for (const v of [
          ...result.delta.propositionVersions,
          ...result.events.flatMap((e: any) => e.assertions),
        ]) {
          v.changeKind = 'CORRECTION';
          v.correctsVersionId = v.supersedesVersionId;
        }
      }
      return result;
    };
    const p = await ready();
    const initial = await loadSnapshot(db, p.headSnapshotId!, p.id);
    const job = await write(p.id);
    expect(job.status, job.errorMessage || '').toBe('SUCCEEDED');
    const receipt = await db.commitReceipt.findUniqueOrThrow({ where: { jobId: job.id } });
    const calls = model.calls.length;
    const current = await loadSnapshot(db, receipt.snapshotId, p.id);
    const proposition = Object.values(current.state.propositions)[0];
    const correction = current.versions[proposition.currentVersionId!];
    expect(correction.changeKind).toBe('CORRECTION');
    expect(correction.truth).toBe('FALSE');
    expect(current.state.knowledge).toEqual(initial.state.knowledge);
    expect(current.versions[correction.correctsVersionId!].truth).toBe('TRUE');
    expect((await loadSnapshot(db, p.headSnapshotId!, p.id)).state).toEqual(initial.state);
    expect(model.calls.length).toBe(calls);
  });
  it('冷回放拒绝缺失、失败、错配的历史审核和不可用规则，不调用模型', async () => {
    const p = await ready();
    const first = await write(p.id);
    expect(first.status).toBe('SUCCEEDED');
    const receipt = await db.commitReceipt.findUniqueOrThrow({ where: { jobId: first.id } });
    const snapshot = await db.snapshot.findUniqueOrThrow({ where: { id: receipt.snapshotId } });
    const proof = await db.artifact.findUniqueOrThrow({ where: { id: snapshot.validationId! } });
    const delta = await db.delta.findUniqueOrThrow({ where: { id: snapshot.deltaId! } });
    const calls = model.calls.length;
    const corrupted = () =>
      expect(loadSnapshot(db, snapshot.id, p.id)).rejects.toMatchObject({
        code: 'STATE_CORRUPTED',
      });
    await db.snapshot.update({ where: { id: snapshot.id }, data: { validationId: uuid() } });
    await corrupted();
    await db.snapshot.update({ where: { id: snapshot.id }, data: { validationId: proof.id } });
    for (const mutate of [
      (v: any) => {
        v.checks[0].verdict = 'UNKNOWN';
      },
      (v: any) => {
        v.input.contentVersionId = uuid();
      },
      (v: any) => {
        v.input.extractionHash = 'bad';
      },
      (v: any) => {
        v.checks[0].spans = [{ textVersionId: receipt.contentId, start: 0, end: 1, quote: '伪' }];
      },
    ]) {
      const payload = structuredClone(proof.payload);
      mutate(payload);
      await db.artifact.update({ where: { id: proof.id }, data: { payload, hash: hash(payload) } });
      await corrupted();
    }
    await db.artifact.update({
      where: { id: proof.id },
      data: { payload: proof.payload, hash: 'bad' },
    });
    await corrupted();
    await db.artifact.update({
      where: { id: proof.id },
      data: { hash: proof.hash, jobId: uuid() },
    });
    await corrupted();
    await db.artifact.update({ where: { id: proof.id }, data: { jobId: proof.jobId } });
    const unsupported = { ...(delta.payload as any), stateRuleVersion: 'future' };
    await db.delta.update({
      where: { id: delta.id },
      data: { payload: unsupported, hash: hash(unsupported) },
    });
    await expect(loadSnapshot(db, snapshot.id, p.id)).rejects.toMatchObject({
      code: 'CONFIG_VERSION_UNAVAILABLE',
    });
    await db.delta.update({
      where: { id: delta.id },
      data: { payload: delta.payload, hash: delta.hash },
    });
    expect((await loadSnapshot(db, snapshot.id, p.id)).state.chapterNo).toBe(1);
    // Previously committed V2 records have no input field: require the matching extraction.
    const legacy = structuredClone(proof.payload) as any;
    delete legacy.input;
    await db.artifact.update({
      where: { id: proof.id },
      data: { payload: legacy, hash: hash(legacy) },
    });
    expect((await loadSnapshot(db, snapshot.id, p.id)).state.chapterNo).toBe(1);
    await db.artifact.deleteMany({ where: { jobId: first.id, kind: 'EXTRACTION' } });
    await corrupted();
    expect(model.calls.length).toBe(calls);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headSnapshotId).toBe(
      snapshot.id,
    );
  });
  it('已提交复活按具体基础规则和正文证据冷回放，许可缺失或错配即停止', async () => {
    const original = model.call.bind(model);
    const ruleId = uuid();
    model.call = async (request) => {
      const result: any = await original(request);
      const input = request.input as any;
      if (request.prompt === 'planning.book')
        result.state.worldRules[ruleId] = {
          description: '旧钟回响可使刚死去的人复活',
          scopeEntityIds: [],
          constraint: null,
          mutable: false,
          active: true,
        };
      if (request.prompt === 'state.extract') {
        const event = result.events[0];
        const key = Object.keys(input.state.characters)[0];
        const changes = [
          {
            collection: 'characters',
            key,
            operation: 'SET_FIELDS',
            expected: { life: 'ALIVE' },
            values: { life: 'DEAD' },
            eventId: event.id,
            order: 1,
          },
          {
            collection: 'characters',
            key,
            operation: 'SET_FIELDS',
            expected: { life: 'DEAD' },
            values: { life: 'ALIVE' },
            eventId: event.id,
            order: 2,
          },
        ];
        event.proposedChanges.push(...changes);
        // The fixture shares these arrays before serialization.
        result.delta.changes = event.proposedChanges;
      }
      if (request.prompt === 'state.validate')
        result.revivalAuthorizations = [
          {
            changeIndex: 2,
            ruleId,
            spans: [input.extraction.events[0].evidence[0].span],
          },
        ];
      return result;
    };
    const p = await ready(20);
    const job = await write(p.id);
    expect(job.status, job.errorMessage || '').toBe('SUCCEEDED');
    const receipt = await db.commitReceipt.findUniqueOrThrow({ where: { jobId: job.id } });
    const snapshot = await db.snapshot.findUniqueOrThrow({ where: { id: receipt.snapshotId } });
    const proof = await db.artifact.findUniqueOrThrow({ where: { id: snapshot.validationId! } });
    const calls = model.calls.length;
    expect(
      Object.values((await loadSnapshot(db, snapshot.id, p.id)).state.characters)[0].life,
    ).toBe('ALIVE');
    for (const mutate of [
      (v: any) => {
        v.revivalAuthorizations = [];
      },
      (v: any) => {
        v.revivalAuthorizations[0].ruleId = uuid();
      },
      (v: any) => {
        v.revivalAuthorizations[0].changeIndex = 0;
      },
      (v: any) => {
        v.revivalAuthorizations[0].spans[0].quote = '错误证据';
      },
    ]) {
      const payload = structuredClone(proof.payload);
      mutate(payload);
      await db.artifact.update({ where: { id: proof.id }, data: { payload, hash: hash(payload) } });
      await expect(loadSnapshot(db, snapshot.id, p.id)).rejects.toMatchObject({
        code: 'STATE_CORRUPTED',
      });
    }
    expect(model.calls.length).toBe(calls);
    await db.artifact.update({
      where: { id: proof.id },
      data: { payload: proof.payload, hash: proof.hash },
    });
    for (let i = 1; i < 20; i++) {
      const next = await write(p.id);
      expect(next.status, next.errorMessage || '').toBe('SUCCEEDED');
    }
    const checkpoint = await db.snapshot.findFirstOrThrow({
      where: { projectId: p.id, chapterNo: 20 },
    });
    expect(checkpoint.checkpoint).not.toBeNull();
    const checkpointCalls = model.calls.length;
    expect((await loadSnapshot(db, checkpoint.id, p.id)).state.chapterNo).toBe(20);
    const checkpointProof = await db.artifact.findUniqueOrThrow({
      where: { id: checkpoint.validationId! },
    });
    const wrongRule = structuredClone(checkpointProof.payload) as any;
    wrongRule.revivalAuthorizations[0].ruleId = uuid();
    await db.artifact.update({
      where: { id: checkpointProof.id },
      data: { payload: wrongRule, hash: hash(wrongRule) },
    });
    await expect(loadSnapshot(db, checkpoint.id, p.id)).rejects.toMatchObject({
      code: 'STATE_CORRUPTED',
    });
    expect(model.calls.length).toBe(checkpointCalls);
  });
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
    const proof20 = old20.validationId;
    await db.snapshot.update({ where: { id: old20.id }, data: { validationId: uuid() } });
    await expect(loadSnapshot(db, old20.id, p.id)).rejects.toMatchObject({
      code: 'STATE_CORRUPTED',
    });
    await expect(loadSnapshot(db, old21, p.id)).rejects.toMatchObject({ code: 'STATE_CORRUPTED' });
    await db.snapshot.update({ where: { id: old20.id }, data: { validationId: proof20 } });
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
      await tx.planVersion.updateMany({
        where: { projectId: p.id, level: 'BOOK', status: 'ACTIVE' },
        data: { chainEpoch: { increment: 1 } },
      });
      await tx.planVersion.updateMany({
        where: { projectId: p.id, level: { not: 'BOOK' }, status: 'ACTIVE' },
        data: { status: 'STALE' },
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
  it('执行当前有效的上层硬文本约束，未来事件不提前要求', async () => {
    const p = await project();
    const openingJob = await engine.startJob(p.id, 'OPENING', p.revision, uuid());
    await engine.tick();
    const completed = await db.job.findUniqueOrThrow({ where: { id: openingJob.id } });
    const refs = completed.artifactRefs as Record<string, string>;
    const openingArtifact = await db.artifact.findUniqueOrThrow({ where: { id: refs.OPENING } });
    const opening = openingArtifact.payload as any;
    const bannedId = uuid(),
      futureId = uuid();
    opening.book.constraints.push(
      {
        id: bannedId,
        severity: 'HARD',
        kind: 'TEXT_RULE',
        targetId: null,
        field: null,
        value: { rule: 'BANNED_PHRASE', argument: '林舟' },
        description: '全书范围内禁止直接出现林舟',
      },
      {
        id: futureId,
        severity: 'HARD',
        kind: 'MUST_EVENT',
        targetId: null,
        field: null,
        value: { eventDescription: '找到失踪的钟匠', atChapter: 3 },
        description: '第3章才必须发生的事件',
      },
    );
    await db.artifact.update({
      where: { id: refs.OPENING },
      data: { payload: opening, hash: hash(opening) },
    });
    await engine.confirmOpening(p.id, refs.OPENING, 0, []);
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    const chapterJob = await engine.startJob(current.id, 'CHAPTER', current.revision, uuid());
    await engine.tick();
    const failed = await db.job.findUniqueOrThrow({ where: { id: chapterJob.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('BODY_REPAIR_EXHAUSTED');
    const evaluation = (
      await db.artifact.findUniqueOrThrow({
        where: { id: (failed.artifactRefs as Record<string, string>).EVALUATION },
      })
    ).payload as any;
    const hard = evaluation.results.find((r: any) => r.evaluatorId === 'core.hard-constraints');
    expect(hard.checkedConstraintIds).toContain(bannedId);
    expect(hard.checkedConstraintIds).not.toContain(futureId);
    expect(hard.issues.some((i: any) => i.ruleId === bannedId)).toBe(true);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
  });
  it('模拟后执行上层STATE_EQUALS硬约束，不能只靠审核checked放行', async () => {
    const p = await project();
    const openingJob = await engine.startJob(p.id, 'OPENING', p.revision, uuid());
    await engine.tick();
    const completed = await db.job.findUniqueOrThrow({ where: { id: openingJob.id } });
    const refs = completed.artifactRefs as Record<string, string>;
    const openingArtifact = await db.artifact.findUniqueOrThrow({ where: { id: refs.OPENING } });
    const opening = openingArtifact.payload as any;
    const locationId = Object.keys(opening.state.locations)[0],
      constraintId = uuid();
    opening.book.constraints.push({
      id: constraintId,
      severity: 'HARD',
      kind: 'STATE_EQUALS',
      targetId: locationId,
      field: 'accessible',
      value: { collection: 'locations', key: locationId, field: 'accessible', equals: false },
      description: '渡口在本章后必须不可进入',
    });
    await db.artifact.update({
      where: { id: refs.OPENING },
      data: { payload: opening, hash: hash(opening) },
    });
    await engine.confirmOpening(p.id, refs.OPENING, 0, []);
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    const chapterJob = await engine.startJob(current.id, 'CHAPTER', current.revision, uuid());
    await engine.tick();
    const failed = await db.job.findUniqueOrThrow({ where: { id: chapterJob.id } });
    expect(failed.status).toBe('WAITING_USER');
    expect(failed.errorCode).toBe('WAITING_USER');
    expect(failed.errorMessage).toContain(constraintId);
    expect(failed.bodyRepairs).toBe(2);
    expect(failed.deltaRepairs).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    expect(await db.activeCommand.count()).toBe(0);
  });
  it('模拟后执行PRESERVE_FACT硬约束，命题真值被改写时拒绝提交', async () => {
    const p = await project();
    const openingJob = await engine.startJob(p.id, 'OPENING', p.revision, uuid());
    await engine.tick();
    const completed = await db.job.findUniqueOrThrow({ where: { id: openingJob.id } });
    const refs = completed.artifactRefs as Record<string, string>;
    const openingArtifact = await db.artifact.findUniqueOrThrow({ where: { id: refs.OPENING } });
    const opening = openingArtifact.payload as any;
    const subjectId = Object.keys(opening.state.locations)[0],
      propositionId = uuid(),
      propositionVersionId = uuid(),
      constraintId = uuid(),
      initialEventId = opening.initialEvents[0].id;
    opening.state.propositions[propositionId] = {
      id: propositionId,
      subjectId,
      predicate: 'is_accessible_by_ferry',
      object: true,
      currentVersionId: propositionVersionId,
    };
    opening.propositionVersions.push({
      id: propositionVersionId,
      propositionId,
      truth: 'TRUE',
      changeKind: 'INITIAL',
      effectiveAtEventId: { kind: 'INITIAL', id: initialEventId },
      recordedAtEventId: { kind: 'INITIAL', id: initialEventId },
      supersedesVersionId: null,
      correctsVersionId: null,
      evidence: [
        {
          origin: 'CANON',
          sourceVersionId: opening.state.canonVersionId,
          span: null,
          assertion: 'EXPLICIT_NARRATION',
          note: '开书初始事实',
        },
      ],
    });
    opening.book.constraints.push({
      id: constraintId,
      severity: 'HARD',
      kind: 'PRESERVE_FACT',
      targetId: propositionId,
      field: 'truth',
      value: { propositionId, truth: 'TRUE' },
      description: '渡口可由渡船抵达必须保持为真',
    });
    await db.artifact.update({
      where: { id: refs.OPENING },
      data: { payload: opening, hash: hash(opening) },
    });
    await engine.confirmOpening(p.id, refs.OPENING, 0, []);
    model.flipFirstPropositionTruth = true;
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    const chapterJob = await engine.startJob(current.id, 'CHAPTER', current.revision, uuid());
    await engine.tick();
    const failed = await db.job.findUniqueOrThrow({ where: { id: chapterJob.id } });
    expect(failed.status).toBe('WAITING_USER');
    expect(failed.errorCode).toBe('WAITING_USER');
    expect(failed.errorMessage).toContain(constraintId);
    expect(failed.bodyRepairs).toBe(2);
    expect(failed.deltaRepairs).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    expect(await db.activeCommand.count()).toBe(0);
  });
  it('Delta格式错误只修状态，不重写已通过审核的正文', async () => {
    const p = await ready();
    model.invalidState = true;
    const j = await write(p.id);
    expect(j.status).toBe('FAILED');
    expect(j.errorCode).toBe('DELTA_REPAIR_EXHAUSTED');
    expect(j.deltaRepairs).toBe(2);
    expect(j.bodyRepairs).toBe(0);
    expect(model.calls.filter((c) => c.prompt === 'state.repair')).toHaveLength(2);
    expect(model.calls.filter((c) => c.prompt === 'production.revise')).toHaveLength(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(0);
    expect(await db.activeCommand.count()).toBe(0);
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
  it('批次子章WAITING_USER增额后可恢复同一子任务，不跳章', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    model.beforeCall = async (r) => {
      if (r.prompt === 'state.validate') throw new AppError('ILLEGAL_REVIVAL', '复活缺少许可');
    };
    expect((await drainBatch(parent.id)).status).toBe('PAUSED');
    const child = await db.job.findFirstOrThrow({ where: { parentId: parent.id } });
    expect(child.status).toBe('WAITING_USER');
    await expect(engine.retry(parent.id, (await getJob(parent.id)).revision)).rejects.toMatchObject(
      { code: 'BODY_REPAIR_EXHAUSTED' },
    );
    await db.job.update({ where: { id: child.id }, data: { bodyRepairLimit: 4 } });
    model.beforeCall = undefined;
    await engine.retry(parent.id, (await getJob(parent.id)).revision);
    expect((await drainBatch(parent.id)).status).toBe('SUCCEEDED');
    expect((await getJob(child.id)).status).toBe('SUCCEEDED');
    expect((await getJob(child.id)).bodyRepairs).toBe(2);
    expect(await db.job.count({ where: { parentId: parent.id } })).toBe(2);
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(2);
  });
  it('解困HTTP新建单章任务结束旧批次，保留已提交章且不自动续写后章', async () => {
    const p = await ready(),
      parent = await batch(p.id, 3);
    await engine.tick();
    await engine.tick();
    model.beforeCall = async (r) => {
      if (r.prompt === 'state.validate') throw new AppError('ILLEGAL_REVIVAL', '复活缺少许可');
    };
    expect((await drainBatch(parent.id)).status).toBe('PAUSED');
    const failed = await db.job.findFirstOrThrow({ where: { parentId: parent.id, number: 2 } });
    const current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    const server = createServer(createApp(db, engine, model));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
    const key = uuid();
    try {
      const info = (await (await fetch(`${base}/jobs/${parent.id}/recovery`)).json()).data;
      expect(info).toMatchObject({
        leafId: failed.id,
        number: 2,
        canRestart: true,
        canResume: false,
      });
      const body = {
        expectedRevision: (await getJob(parent.id)).revision,
        projectRevision: current.revision,
        mode: 'GENERATE',
        draftRevision: null,
      };
      const post = (body: unknown) =>
        fetch(`${base}/jobs/${parent.id}/restart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:7456',
            'Idempotency-Key': key,
          },
          body: JSON.stringify(body),
        });
      expect((await post({ ...body, expectedRevision: 0 })).status).toBe(409);
      const result = await post(body);
      expect(result.status).toBe(202);
      const next = (await result.json()).data;
      expect((await (await post(body)).json()).data.id).toBe(next.id);
      expect(next.number).toBe(2);
      expect(next.parentId).toBeNull();
      expect((await getJob(parent.id)).status).toBe('CANCELLED');
      expect((await getJob(failed.id)).httpUsed).toBe(failed.httpUsed);
      model.beforeCall = undefined;
      await engine.tick();
      expect((await getJob(next.id)).status).toBe('SUCCEEDED');
      expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).headChapter).toBe(2);
      expect(await db.job.count({ where: { parentId: parent.id, number: 3 } })).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
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
    await expect(engine.retry(parent.id, paused.revision)).rejects.toMatchObject({
      code: 'BODY_REPAIR_EXHAUSTED',
    });
    await db.job.update({
      where: { id: failed.id },
      data: { bodyRepairLimit: 4, revision: { increment: 1 } },
    });
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
  it('批次已推进revision时，旧面板上的暂停请求仍能登记', async () => {
    const p = await ready(),
      parent = await batch(p.id, 2);
    await engine.tick();
    expect((await getJob(parent.id)).revision).toBeGreaterThan(parent.revision);
    await engine.pause(parent.id, parent.revision);
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
