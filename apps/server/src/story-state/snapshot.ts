import type { Snapshot } from '@prisma/client';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  stateSchema,
  type StoryState,
  type PropositionVersion,
  type Extraction,
} from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import { canonical, hash, requireThat } from '../platform/core.js';
import { simulate } from './service.js';
export const pack = (state: StoryState) => gzipSync(canonical(state));
export async function loadSnapshot(db: DB, id: string, projectId: string) {
  const chain: Snapshot[] = [];
  const initial = await db.snapshot.findUnique({ where: { id } });
  requireThat(initial && initial.projectId === projectId, 'NOT_FOUND', '找不到本项目快照', 404);
  let cursor: Snapshot = initial;
  const meta = cursor,
    seen = new Set<string>();
  while (!cursor.checkpoint) {
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
  let state = stateSchema.parse(JSON.parse(gunzipSync(cursor.checkpoint).toString('utf8')));
  requireThat(hash(state) === cursor.stateHash, 'STATE_CORRUPTED', 'Checkpoint校验失败');
  const ancestorIds: string[] = [];
  let ancestor = cursor;
  while (ancestor) {
    ancestorIds.push(ancestor.id);
    if (!ancestor.parentId) break;
    const parent = await db.snapshot.findUnique({ where: { id: ancestor.parentId } });
    requireThat(
      parent && parent.projectId === projectId && !ancestorIds.includes(parent.id),
      'STATE_CORRUPTED',
      '历史父链损坏',
    );
    ancestor = parent;
  }
  const versions: Record<string, PropositionVersion> = {};
  for (const p of await db.propositionVersion.findMany({
    where: { projectId, snapshotId: { in: ancestorIds } },
  }))
    versions[p.id] = p.payload as PropositionVersion;
  for (const snapshot of chain.reverse()) {
    requireThat(snapshot.deltaId && snapshot.contentId, 'STATE_CORRUPTED', 'Delta引用缺失');
    const d = await db.delta.findUnique({ where: { id: snapshot.deltaId } }),
      c = await db.content.findUnique({ where: { id: snapshot.contentId } });
    requireThat(
      d &&
        c &&
        d.baseSnapshotId === snapshot.parentId &&
        hash(d.payload) === d.hash &&
        hash(c.text) === c.hash,
      'STATE_CORRUPTED',
      'Delta或正文哈希错误',
    );
    const events = await db.storyEvent.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { eventOrder: 'asc' },
    });
    const x = { delta: d.payload, events: events.map((e) => e.payload) } as Extraction;
    state = simulate(state, snapshot.parentId!, x, c.text, c.id, versions, true);
    for (const p of x.delta.propositionVersions) versions[p.id] = p;
    requireThat(hash(state) === snapshot.stateHash, 'STATE_CORRUPTED', '回放状态哈希不一致');
    ancestorIds.push(snapshot.id);
  }
  return { meta, state, versions, ancestorIds };
}
