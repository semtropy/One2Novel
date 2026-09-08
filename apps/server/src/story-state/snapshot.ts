import type { Snapshot } from '@prisma/client';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  stateSchema,
  extractionSchema,
  type StoryState,
  type PropositionVersion,
} from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import { AppError, canonical, hash, requireThat } from '../platform/core.js';
import { simulate } from './service.js';
import { checkStateValidation } from './validation.js';
export const pack = (state: StoryState) => gzipSync(canonical(state));
const replayRules: Record<string, typeof simulate> = { '1': simulate };
async function transition(db: DB, snapshot: Snapshot) {
  requireThat(
    snapshot.deltaId && snapshot.contentId && snapshot.validationId,
    'STATE_CORRUPTED',
    '快照缺少Delta、正文或状态审核引用',
  );
  const d = await db.delta.findUnique({ where: { id: snapshot.deltaId } });
  const c = await db.content.findUnique({
    where: { id: snapshot.contentId },
    include: { chapter: true },
  });
  const v = await db.artifact.findUnique({ where: { id: snapshot.validationId } });
  requireThat(
    d &&
      c &&
      v &&
      d.projectId === snapshot.projectId &&
      c.chapter.projectId === snapshot.projectId &&
      c.chapter.number === snapshot.chapterNo &&
      d.contentId === c.id &&
      d.baseSnapshotId === snapshot.parentId &&
      hash(d.payload) === d.hash &&
      hash(c.text) === c.hash &&
      v.kind === 'STATE_VALIDATION' &&
      v.projectId === snapshot.projectId &&
      v.baseSnapshotId === snapshot.parentId &&
      v.jobId &&
      hash(v.payload) === v.hash,
    'STATE_CORRUPTED',
    'Delta、正文或状态审核来源/哈希错误',
  );
  const receipt = await db.commitReceipt.findUnique({ where: { jobId: v.jobId } });
  requireThat(
    receipt?.snapshotId === snapshot.id && receipt.contentId === c.id,
    'STATE_CORRUPTED',
    '状态审核不属于本次正式提交',
  );
  const ruleVersion = (d.payload as { stateRuleVersion?: string }).stateRuleVersion;
  const replay =
    ruleVersion && Object.hasOwn(replayRules, ruleVersion) ? replayRules[ruleVersion] : undefined;
  requireThat(replay, 'CONFIG_VERSION_UNAVAILABLE', '历史状态规则版本不可用');
  const events = await db.storyEvent.findMany({
    where: { snapshotId: snapshot.id },
    orderBy: { eventOrder: 'asc' },
  });
  requireThat(
    events.every(
      (e) =>
        e.projectId === snapshot.projectId &&
        e.contentId === c.id &&
        (e.payload as { id: string; order: number }).id === e.id &&
        (e.payload as { order: number }).order === e.eventOrder,
    ),
    'STATE_CORRUPTED',
    '事件归属不一致',
  );
  const x = extractionSchema.parse({ delta: d.payload, events: events.map((e) => e.payload) });
  const proof = checkStateValidation(v.payload, x, c.text);
  // Existing V2 commits predate input binding: require their original extraction artifact.
  if (!proof.input) {
    const originals = await db.artifact.findMany({
      where: {
        jobId: v.jobId,
        projectId: snapshot.projectId,
        baseSnapshotId: snapshot.parentId,
        kind: 'EXTRACTION',
      },
    });
    requireThat(
      originals.some((a) => a.hash === hash(x) && hash(a.payload) === a.hash),
      'STATE_CORRUPTED',
      '历史审核缺少匹配的原始抽取产物',
    );
  }
  return { x, c, proof, replay };
}
export async function loadSnapshot(db: DB, id: string, projectId: string) {
  try {
    return await readSnapshot(db, id, projectId);
  } catch (e) {
    if (
      e instanceof AppError &&
      ['NOT_FOUND', 'STATE_CORRUPTED', 'CONFIG_VERSION_UNAVAILABLE'].includes(e.code)
    )
      throw e;
    throw new AppError('STATE_CORRUPTED', '快照或历史状态审核校验失败');
  }
}
async function readSnapshot(db: DB, id: string, projectId: string) {
  const chain: Snapshot[] = [];
  const initial = await db.snapshot.findUnique({ where: { id } });
  requireThat(initial && initial.projectId === projectId, 'NOT_FOUND', '找不到本项目快照', 404);
  let cursor: Snapshot = initial;
  const meta = cursor,
    seen = new Set<string>();
  while (!cursor.checkpoint) {
    requireThat(
      cursor.schemaVersion === 1,
      'CONFIG_VERSION_UNAVAILABLE',
      '历史快照Schema版本不可用',
    );
    requireThat(!seen.has(cursor.id) && cursor.parentId, 'STATE_CORRUPTED', '快照父链损坏');
    seen.add(cursor.id);
    chain.push(cursor);
    const parent = await db.snapshot.findUnique({ where: { id: cursor.parentId } });
    requireThat(
      parent && parent.projectId === projectId && parent.chapterNo === cursor.chapterNo - 1,
      'STATE_CORRUPTED',
      '快照父链缺失或错误',
    );
    cursor = parent;
  }
  requireThat(cursor.schemaVersion === 1, 'CONFIG_VERSION_UNAVAILABLE', '历史快照Schema版本不可用');
  let state = stateSchema.parse(JSON.parse(gunzipSync(cursor.checkpoint).toString('utf8')));
  requireThat(
    hash(state) === cursor.stateHash &&
      state.projectId === projectId &&
      state.chapterNo === cursor.chapterNo &&
      state.canonVersionId === cursor.canonId,
    'STATE_CORRUPTED',
    'Checkpoint校验失败',
  );
  const ancestorIds: string[] = [];
  let ancestor = cursor;
  while (ancestor) {
    ancestorIds.push(ancestor.id);
    if (!ancestor.parentId) break;
    const parent = await db.snapshot.findUnique({ where: { id: ancestor.parentId } });
    requireThat(
      parent &&
        parent.projectId === projectId &&
        parent.chapterNo === ancestor.chapterNo - 1 &&
        parent.canonId === ancestor.canonId &&
        !ancestorIds.includes(parent.id),
      'STATE_CORRUPTED',
      '历史父链损坏',
    );
    ancestor = parent;
  }
  requireThat(
    ancestor.chapterNo === 0 && !ancestor.deltaId && !ancestor.contentId,
    'STATE_CORRUPTED',
    '历史父链未终止于State 0',
  );
  if (cursor.chapterNo > 0) {
    const committed = await transition(db, cursor);
    if (committed.proof.revivalAuthorizations.length) {
      const base = await loadSnapshot(db, cursor.parentId!, projectId);
      checkStateValidation(committed.proof, committed.x, committed.c.text, base.state);
      requireThat(
        hash(
          committed.replay(
            base.state,
            cursor.parentId!,
            committed.x,
            committed.c.text,
            committed.c.id,
            base.versions,
            new Set(committed.proof.revivalAuthorizations.map((p) => p.changeIndex)),
          ),
        ) === cursor.stateHash,
        'STATE_CORRUPTED',
        'Checkpoint复活许可与回放结果不一致',
      );
    }
  }
  const versions: Record<string, PropositionVersion> = {};
  for (const p of await db.propositionVersion.findMany({
    where: { projectId, snapshotId: { in: ancestorIds } },
  }))
    versions[p.id] = p.payload as PropositionVersion;
  for (const snapshot of chain.reverse()) {
    const { x, c, proof, replay } = await transition(db, snapshot);
    checkStateValidation(proof, x, c.text, state);
    state = replay(
      state,
      snapshot.parentId!,
      x,
      c.text,
      c.id,
      versions,
      new Set(proof.revivalAuthorizations.map((p) => p.changeIndex)),
    );
    for (const p of x.delta.propositionVersions) versions[p.id] = p;
    requireThat(hash(state) === snapshot.stateHash, 'STATE_CORRUPTED', '回放状态哈希不一致');
    ancestorIds.push(snapshot.id);
  }
  return { meta, state, versions, ancestorIds };
}
