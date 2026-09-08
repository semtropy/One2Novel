import { zipFiles, epubEntries } from '../fixtures/epub.js';
import {
  decodeUploadFilename,
  referenceDisplayTitle,
} from '../../apps/server/src/reference/filename.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import Database from 'better-sqlite3';
import { createDb, initializeDb, type DB } from '../../apps/server/src/platform/db.js';
import { seedConfig, saveConfig } from '../../apps/server/src/orchestrator/config.js';
import { Orchestrator } from '../../apps/server/src/orchestrator/service.js';
import { createApp } from '../../apps/server/src/http.js';
import { hash, uuid } from '../../apps/server/src/platform/core.js';
import { loadSnapshot } from '../../apps/server/src/story-state/snapshot.js';
import {
  registry,
  retrieveEntities,
  validateReferenceResult,
} from '../../apps/server/src/reference/analysis.js';
import { migrateTestDb } from '../fixtures/migrate.js';
import { FakeModel, testSettings } from '../fixtures/fake-model.js';
import { defaultStyle } from '@one2novel/contracts';
let db: DB, engine: Orchestrator, model: FakeModel, dir: string, server: Server, url: string;
beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'one2novel-library-'));
  const path = resolve(dir, 'test.db'),
    native = new Database(path);
  migrateTestDb(native);
  native.close();
  db = createDb(`file:${path.replaceAll('\\', '/')}`);
  await initializeDb(db);
  await seedConfig(db);
  await saveConfig(db, 'models', testSettings, 0);
  model = new FakeModel();
  engine = new Orchestrator(db, model);
  server = createServer(createApp(db, engine, model));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
});
afterEach(async () => {
  await engine.stop();
  await new Promise<void>((r) => server.close(() => r()));
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
async function request(path: string, method = 'GET', body?: unknown, expected = 200, key = uuid()) {
  const r = await fetch(url + path, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:7456',
      'Idempotency-Key': key,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const json = await r.json();
  expect(r.status, JSON.stringify(json)).toBe(expected);
  return json.data;
}
const sample =
  '第一章 旧地图\n陆砚来到钟楼，打开旧地图。\n\n第二章 来信\n陆砚读到一封来信，决定寻找摆渡人。';
async function imported(text = sample) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), 'reference.txt');
  form.append('encoding', 'UTF8');
  const source = await request('/references', 'POST', form, 201);
  return request(`/references/${source.id}`);
}
async function startAnalysis(source: any) {
  await request(`/references/${source.id}/split/${source.splits[0].id}/publish`, 'POST', {
    expectedRevision: source.revision,
  });
  source = await request(`/references/${source.id}`);
  return request(
    `/references/${source.id}/analyze`,
    'POST',
    { splitVersionId: source.activeSplitId, expectedRevision: source.revision },
    202,
  );
}
async function done(jobId: string) {
  await engine.tick();
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  expect(job.status, job.errorMessage || '').toBe('SUCCEEDED');
  return job;
}
async function analyzed() {
  const source = await imported(),
    job = await startAnalysis(source);
  await done(job.id);
  const detail = await request(`/references/${source.id}`);
  await request(`/references/${source.id}/publish`, 'POST', {
    analysisVersionId: detail.analyses[0].id,
    expectedRevision: detail.revision,
  });
  return request(`/references/${source.id}`);
}
async function publish(itemId: string) {
  const item = await request(`/knowledge/${itemId}`),
    v = item.versions[0];
  await request(`/knowledge/${itemId}/publish`, 'POST', {
    versionId: v.id,
    expectedRevision: item.revision,
  });
  return request(`/knowledge/${itemId}`);
}
async function derived(sourceVersionId: string, kind: string) {
  const j = await request('/knowledge', 'POST', { kind, title: kind, sourceVersionId }, 202);
  await done(j.id);
  return publish(j.input.itemId);
}
async function project() {
  return request(
    '/projects',
    'POST',
    {
      title: '新小说',
      idea: '星港来信引出失踪的信使',
      genre: '悬疑',
      targetCount: 3,
      targetLength: 500,
      requirements: { must: [], avoid: [], preferences: [] },
    },
    201,
  );
}

describe('参考 → 知识 → 新小说闭环', () => {
  it('参考分析取消和重启释放执行锁；重启不自动收费，恢复仍使用同一任务', async () => {
    const source = await imported(),
      first = await startAnalysis(source);
    model.beforeCall = async (r) => {
      if (r.prompt === 'reference.chapter') await engine.cancel(first.id);
    };
    await engine.tick();
    expect((await db.job.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('CANCELLED');
    expect(await db.libraryCommand.count()).toBe(0);
    expect(
      (await db.referenceAnalysis.findUniqueOrThrow({ where: { jobId: first.id } })).completedChars,
    ).toBe(0);
    model.beforeCall = undefined;
    const s = await request(`/references/${source.id}`);
    const second = await request(
      `/references/${s.id}/analyze`,
      'POST',
      { splitVersionId: s.activeSplitId, expectedRevision: s.revision },
      202,
    );
    const count = model.calls.length;
    await engine.recover();
    const interrupted = await db.job.findUniqueOrThrow({ where: { id: second.id } });
    expect(interrupted.status).toBe('INTERRUPTED');
    expect(model.calls).toHaveLength(count);
    expect(await db.libraryCommand.count()).toBe(0);
    await engine.retry(second.id, interrupted.revision);
    await done(second.id);
  });
  it.each(['KEEP_SEPARATE', 'MERGE'] as const)(
    '同名身份必须显式确认：%s生成新版本，原分析不变',
    async (action) => {
      const source = await imported(),
        job = await startAnalysis(source);
      const call = model.call.bind(model);
      model.call = async (r) => {
        const result: any = await call(r);
        if (r.prompt === 'reference.chapter' && (r.input as any).chapterNo === 2) {
          const id = uuid();
          result.entities[0].id = id;
          result.events[0].actorIds = [id];
        }
        return result;
      };
      await engine.tick();
      const detail = await request(`/references/${source.id}`),
        old = detail.analyses[0];
      expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).errorCode).toBe(
        'ENTITY_UNRESOLVED',
      );
      expect(old.status).toBe('PARTIAL');
      const conflict = old.units[1].payload.unresolvedIdentities[0];
      const fresh = await request(
        `/references/${source.id}/entity-resolutions`,
        'POST',
        {
          analysisVersionId: old.id,
          expectedRevision: detail.revision,
          decisions: [
            {
              candidateId: conflict.candidateId,
              action,
              targetEntityId: action === 'MERGE' ? conflict.possibleEntityIds[0] : null,
            },
          ],
        },
        201,
      );
      expect(fresh.id).not.toBe(old.id);
      expect(fresh.status).toBe('COMPLETE');
      expect(await registry(db, fresh.id, fresh.registryHead)).toHaveLength(
        action === 'MERGE' ? 1 : 2,
      );
      expect(
        (await db.referenceUnit.findUniqueOrThrow({ where: { id: old.units[1].id } })).hash,
      ).toBe(old.units[1].hash);
      expect(await registry(db, fresh.id, 0)).toHaveLength(0);
      const updated = await request(`/references/${source.id}`);
      await request(`/references/${source.id}/publish`, 'POST', {
        analysisVersionId: fresh.id,
        expectedRevision: updated.revision,
      });
    },
  );

  it('证据必须精确匹配，重叠区不重复计事件；命名命中超额时停止而不截断', async () => {
    const s = await analyzed(),
      a = s.analyses[0],
      u = a.units[0];
    const bad = structuredClone(u.payload);
    bad.events[0].evidence.quote = '不在原文';
    expect(() =>
      validateReferenceResult(
        bad,
        sample,
        u.payload.events[0].evidence.textVersionId,
        0,
        u.end,
        [],
        false,
      ),
    ).toThrow();
    expect(() =>
      validateReferenceResult(
        u.payload,
        sample,
        u.payload.events[0].evidence.textVersionId,
        0,
        u.end,
        [],
        false,
        u.end - 1,
      ),
    ).toThrow('重叠区');
    await db.referenceEntity.deleteMany({ where: { analysisId: a.id } });
    const names = Array.from({ length: 61 }, (_, n) => `人名${n}号`);
    for (const name of names) {
      const id = uuid();
      await db.referenceEntity.create({
        data: {
          rowId: uuid(),
          entityId: id,
          analysisId: a.id,
          throughUnit: 1,
          chapterNo: 1,
          payload: { ...u.payload.entities[0], id, name },
        },
      });
    }
    await expect(retrieveEntities(db, a.id, 1, 2, names.join(' '))).rejects.toThrow(
      '同名实体候选超出容量',
    );
    expect((await retrieveEntities(db, a.id, 0, 2, names.join(' '))).candidates).toHaveLength(0);
    const limited = await retrieveEntities(db, a.id, 1, 2, '没有命中');
    expect(limited.candidates.length).toBeLessThanOrEqual(60);
    expect([...JSON.stringify(limited.candidates)].length).toBeLessThan(12000);
  });
  it('TXT完整导入、分析发布、框架和素材清洗改编、绑定并完成两章', async () => {
    const s = await analyzed(),
      analysis = s.analyses[0];
    expect(analysis.completedChars).toBe([...sample].length);
    expect(analysis.units).toHaveLength(2);
    const originals = await registry(db, analysis.id, analysis.registryHead);
    expect(originals).toHaveLength(1);
    expect((await db.referenceSource.findUniqueOrThrow({ where: { id: s.id } })).original).toEqual(
      new Uint8Array(Buffer.from(sample)),
    );
    const framework = await derived(analysis.id, 'FRAMEWORK'),
      raw = await derived(analysis.id, 'ASSET_PACK'),
      p = await project();
    expect(raw.versions[0].payload.assets[0].sourceSpans).toHaveLength(2);
    const invalidFramework = structuredClone(framework.versions[0].payload);
    invalidFramework.statistics.hookRate = 0.75;
    await request(
      `/knowledge/${framework.id}/versions`,
      'POST',
      { payload: invalidFramework, expectedRevision: framework.revision },
      422,
    );
    await request(
      `/projects/${p.id}/knowledge-bindings`,
      'PUT',
      { versionIds: [raw.activeVersionId], expectedRevision: p.revision },
      422,
    );
    let j = await request(
      `/knowledge/${raw.id}/clean`,
      'POST',
      { sourceVersionId: raw.activeVersionId, expectedRevision: raw.revision },
      202,
    );
    await done(j.id);
    const clean = await publish(raw.id);
    j = await request(
      `/knowledge/${raw.id}/adapt`,
      'POST',
      {
        sourceVersionId: clean.activeVersionId,
        expectedRevision: clean.revision,
        adaptationBrief: '将所有素材改编为星港背景与全新人物目标',
      },
      202,
    );
    await done(j.id);
    const adapted = await publish(raw.id);
    expect(adapted.versions[0].payload.stage).toBe('ADAPTED');
    expect(adapted.versions[0].payload.assets[0].name).not.toBe('陆砚');
    const style = await request(
        '/knowledge',
        'POST',
        {
          kind: 'STYLE',
          title: '清晰冷静',
          payload: { ...defaultStyle, tone: ['冷静'], instructions: ['用具体行动表现不安'] },
        },
        201,
      ),
      publishedStyle = await publish(style.id);
    const template = await request(
        '/knowledge',
        'POST',
        {
          kind: 'TEMPLATE',
          title: '线索推进',
          payload: {
            target: 'CHAPTER',
            schemaId: 'CHAPTER',
            defaults: { summary: '每章推进一条线索' },
            guidance: ['让行动产生后果'],
          },
        },
        201,
      ),
      publishedTemplate = await publish(template.id);
    const ids = [
      framework.activeVersionId,
      adapted.activeVersionId,
      publishedStyle.activeVersionId,
      publishedTemplate.activeVersionId,
    ];
    await request(`/projects/${p.id}/knowledge-bindings`, 'PUT', {
      versionIds: ids,
      expectedRevision: p.revision,
    });
    let current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    j = await engine.startJob(p.id, 'OPENING', current.revision, uuid());
    const opening = await done(j.id);
    const openingArtifact = await db.artifact.findUniqueOrThrow({
      where: { id: (opening.artifactRefs as any).OPENING },
    });
    const invalidOpening = { ...(openingArtifact.payload as any), adaptationMap: [] };
    await request(
      `/projects/${p.id}/opening-candidates`,
      'POST',
      { expectedRevision: current.revision, payload: invalidOpening },
      422,
    );
    await engine.confirmOpening(p.id, (opening.artifactRefs as any).OPENING, current.revision, []);
    for (let n = 0; n < 2; n++) {
      current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
      j = await engine.startJob(p.id, 'CHAPTER', current.revision, uuid());
      await done(j.id);
    }
    const calls = model.calls.filter((c) =>
      ['planning.book', 'planning.rolling', 'production.write'].includes(c.prompt),
    );
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls)
      expect((c.input as any).knowledge.items.map((i: any) => i.versionId).sort()).toEqual(
        [...ids].sort(),
      );
    const written = model.calls.find((c) => c.prompt === 'production.write')!.input as any;
    expect(written.style.tone).toEqual(['冷静']);
    current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(current.headChapter).toBe(2);
    const state = await loadSnapshot(db, current.headSnapshotId!, p.id);
    expect(Object.keys(state.state.entities)).not.toContain(originals[0].entity.id);
    expect(Object.values(state.state.entities).map((e) => e.name)).not.toContain('陆砚');
    expect(await db.libraryCommand.count()).toBe(0);
  }, 30000);

  it('模型伪造引用豁免无效，只有用户授权引用可以通过重复门禁', async () => {
    const quote =
        '陆砚沿着旧街寻找钟楼，手里的地图边缘写满潮湿的暗号，他在石阶旁停下，听见远处钟声一下一下落进河面，又看见摆渡人留下的铜扣压住半封没有署名的信。信纸背面还有一排细小刻痕，像是有人故意把回程路线藏进潮水涨落的次序里。',
      source = await imported(`第一章 引文\n${quote}\n\n第二章 收束\n陆砚确认地图来自渡口。`);
    let job = await startAnalysis(source);
    await done(job.id);
    let detail = await request(`/references/${source.id}`);
    await request(`/references/${source.id}/publish`, 'POST', {
      analysisVersionId: detail.analyses[0].id,
      expectedRevision: detail.revision,
    });
    detail = await request(`/references/${source.id}`);
    const framework = await derived(detail.analyses[0].id, 'FRAMEWORK'),
      sourceRef = {
        kind: 'REFERENCE_ANALYSIS',
        id: source.id,
        versionId: detail.analyses[0].id,
      };

    let p = await project();
    await request(`/projects/${p.id}/knowledge-bindings`, 'PUT', {
      versionIds: [framework.activeVersionId],
      expectedRevision: p.revision,
    });
    p = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    model.bodyPrefix = quote;
    model.forgedAllowedQuotes = [{ text: quote, sourceRef }];
    job = await engine.startJob(p.id, 'OPENING', p.revision, uuid());
    job = await done(job.id);
    await engine.confirmOpening(p.id, (job.artifactRefs as any).OPENING, p.revision, []);
    p = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    job = await engine.startJob(p.id, 'CHAPTER', p.revision, uuid());
    await engine.tick();
    const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('BODY_REPAIR_EXHAUSTED');
    const forgedPlan = await db.artifact.findFirstOrThrow({
      where: { projectId: p.id, kind: 'PLAN', jobId: job.id },
    });
    expect((forgedPlan.payload as any).allowedQuotes).toEqual([]);

    model.bodyPrefix = quote;
    model.forgedAllowedQuotes = [{ text: quote, sourceRef }];
    let allowed = await project();
    await request(`/projects/${allowed.id}/knowledge-bindings`, 'PUT', {
      versionIds: [framework.activeVersionId],
      expectedRevision: allowed.revision,
    });
    allowed = await db.project.findUniqueOrThrow({ where: { id: allowed.id } });
    await request(
      `/projects/${allowed.id}/authorized-quotes`,
      'POST',
      {
        expectedRevision: allowed.revision,
        text: quote,
        sourceRef,
      },
      201,
    );
    allowed = await db.project.findUniqueOrThrow({ where: { id: allowed.id } });
    job = await engine.startJob(allowed.id, 'OPENING', allowed.revision, uuid());
    job = await done(job.id);
    await engine.confirmOpening(
      allowed.id,
      (job.artifactRefs as any).OPENING,
      allowed.revision,
      [],
    );
    allowed = await db.project.findUniqueOrThrow({ where: { id: allowed.id } });
    job = await engine.startJob(allowed.id, 'CHAPTER', allowed.revision, uuid());
    await done(job.id);
    const authorizedPlan = await db.artifact.findFirstOrThrow({
      where: { projectId: allowed.id, kind: 'PLAN', jobId: job.id },
    });
    expect((authorizedPlan.payload as any).allowedQuotes).toEqual([{ text: quote, sourceRef }]);
  }, 30000);

  it('失败只保留已分析覆盖；不能发布PARTIAL；恢复不重复前单元且候选版本隔离', async () => {
    const source = await imported();
    const j = await startAnalysis(source);
    model.beforeCall = async (r) => {
      if (r.prompt === 'reference.chapter' && (r.input as any).chapterNo === 2)
        throw Error('second unit unavailable');
    };
    await engine.tick();
    let detail = await request(`/references/${source.id}`),
      analysis = detail.analyses[0];
    expect(analysis.status).toBe('PARTIAL');
    expect(analysis.completedChars).toBe(analysis.units[0].end);
    await request(
      `/references/${source.id}/publish`,
      'POST',
      { analysisVersionId: analysis.id, expectedRevision: detail.revision },
      422,
    );
    const firstId = analysis.units[0].id,
      firstHash = analysis.units[0].hash;
    const failed = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    model.beforeCall = undefined;
    await engine.retry(j.id, failed.revision);
    await done(j.id);
    detail = await request(`/references/${source.id}`);
    analysis = detail.analyses[0];
    expect(analysis.units[0].id).toBe(firstId);
    expect(analysis.units[0].hash).toBe(firstHash);
    expect(
      model.calls.filter(
        (c) => c.prompt === 'reference.chapter' && (c.input as any).chapterNo === 1,
      ),
    ).toHaveLength(1);
    expect(await registry(db, analysis.id, 0)).toHaveLength(0);
    expect(await registry(db, analysis.id, 1)).toHaveLength(1);
    expect(analysis.units[1].retrieval.registryVersion).toBe(1);
  });

  it('不可发布伪造来源与沿用原名的改编；新版本不改变既有绑定，换绑定使旧任务过期', async () => {
    const s = await analyzed(),
      raw = await derived(s.analyses[0].id, 'ASSET_PACK');
    let job = await request(
      `/knowledge/${raw.id}/clean`,
      'POST',
      { sourceVersionId: raw.activeVersionId, expectedRevision: raw.revision },
      202,
    );
    await done(job.id);
    const clean = await publish(raw.id);
    job = await request(
      `/knowledge/${raw.id}/adapt`,
      'POST',
      {
        sourceVersionId: clean.activeVersionId,
        expectedRevision: clean.revision,
        adaptationBrief: '重新设计身份和背景',
      },
      202,
    );
    await done(job.id);
    const item = await publish(raw.id),
      copy = structuredClone(item.versions[0].payload);
    copy.assets[0].name = '陆砚';
    await request(
      `/knowledge/${item.id}/versions`,
      'POST',
      { expectedRevision: item.revision, payload: copy },
      422,
    );
    copy.assets[0].name = '改编角色';
    copy.assets[0].sourceSpans[0].quote = '伪造证据';
    await request(
      `/knowledge/${item.id}/versions`,
      'POST',
      { expectedRevision: item.revision, payload: copy },
      422,
    );
    const style = await request(
        '/knowledge',
        'POST',
        { kind: 'STYLE', title: '风格', payload: defaultStyle },
        201,
      ),
      old = await publish(style.id),
      p = await project();
    await request(`/projects/${p.id}/knowledge-bindings`, 'PUT', {
      expectedRevision: p.revision,
      versionIds: [old.activeVersionId],
    });
    let current = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    job = await engine.startJob(p.id, 'OPENING', current.revision, uuid());
    await request(
      `/projects/${p.id}/knowledge-bindings`,
      'PUT',
      { expectedRevision: current.revision, versionIds: [] },
      409,
    );
    await engine.recover();
    const v = await request(
      `/knowledge/${style.id}/versions`,
      'POST',
      { expectedRevision: old.revision, payload: { ...defaultStyle, tone: ['新风格'] } },
      201,
    );
    const fresh = await publish(style.id);
    expect((await request(`/projects/${p.id}/knowledge-bindings`)).items[0].versionId).toBe(
      old.activeVersionId,
    );
    await request(`/projects/${p.id}/knowledge-bindings`, 'PUT', {
      expectedRevision: current.revision,
      versionIds: [fresh.activeVersionId],
    });
    await expect(
      engine.retry(job.id, (await db.job.findUniqueOrThrow({ where: { id: job.id } })).revision),
    ).rejects.toMatchObject({ code: 'STALE_INPUT' });
    expect(fresh.activeVersionId).toBe(v.id);
  });

  it('切分不遗漏长章；越界切分拒绝；同文件哈希去重', async () => {
    const text = '第一章 长路\n陆砚' + '沿着山路寻找钟楼。'.repeat(1800),
      s = await imported(text);
    const same = await imported(text);
    expect(same.id).toBe(s.id);
    await request(
      `/references/${s.id}/split`,
      'PUT',
      { expectedRevision: s.revision, chapters: [{ title: '截断', start: 0, end: 10 }] },
      422,
    );
    const j = await startAnalysis(s),
      a = await db.referenceAnalysis.findUniqueOrThrow({
        where: { jobId: j.id },
        include: { units: { orderBy: { number: 'asc' } } },
      });
    expect(a.units.length).toBeGreaterThan(2);
    expect(a.units.reduce((n, u) => n + u.end - u.start, 0)).toBe([...text].length);
    expect(a.units[1].start - a.units[1].inputStart).toBe(300);
    await engine.cancel(j.id);
  });
});

describe('中文上传文件名', () => {
  it('中文EPUB名称正确落库，旧乱码列表/详情/重复导入兼容且不改变正文', async () => {
    const filename = '我家老婆来自一千年前(花还没开).epub';
    const buffer = await zipFiles(epubEntries);
    const upload = () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(buffer)], { type: 'application/epub+zip' }),
        filename,
      );
      return form;
    };
    const source = await request('/references', 'POST', upload(), 201);
    expect(source.title).toBe(filename);
    const stored = await db.referenceSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(stored.title).toBe(filename);
    expect(stored.text).toContain('陆砚展开旧地图');
    await db.referenceSource.update({
      where: { id: source.id },
      data: { title: Buffer.from(filename).toString('latin1') },
    });
    expect((await request('/references'))[0].title).toBe(filename);
    expect((await request(`/references/${source.id}`)).title).toBe(filename);
    const duplicate = await request('/references', 'POST', upload(), 201);
    expect(duplicate.id).toBe(source.id);
    expect(duplicate.title).toBe(filename);
    const after = await db.referenceSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.textHash).toBe(stored.textHash);
    expect(after.revision).toBe(stored.revision);
  });
  it('保留显式作品名，不重复解码正确中文或破坏西文文件名', async () => {
    for (const name of ['正确中文.txt', 'café.txt', 'plain.txt', '小说🌙.epub']) {
      expect(decodeUploadFilename(name)).toBe(name);
      expect(referenceDisplayTitle(name)).toBe(name);
    }
    const form = new FormData();
    form.append('file', new Blob([sample]), '中文参考.txt');
    form.append('title', '自定义中文标题');
    expect((await request('/references', 'POST', form, 201)).title).toBe('自定义中文标题');
  });
});
