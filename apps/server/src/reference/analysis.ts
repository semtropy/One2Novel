import type { DB, Tx } from '../platform/db.js';
import { hash, requireThat, remapProposal, identifiers, uuid } from '../platform/core.js';
import {
  referenceResultSchema,
  type ReferenceResult,
  type ReferenceEntityData,
} from '@one2novel/contracts';
import { bm25 } from '../platform/lexical.js';

export async function registry(db: DB | Tx, analysisId: string, version: number) {
  const rows = await db.referenceEntity.findMany({
    where: { analysisId, throughUnit: { lte: version } },
    orderBy: { throughUnit: 'asc' },
  });
  const map = new Map<string, { entity: ReferenceEntityData; unit: number; chapter: number }>();
  for (const r of rows)
    map.set(r.entityId, {
      entity: r.payload as ReferenceEntityData,
      unit: r.throughUnit,
      chapter: r.chapterNo,
    });
  return [...map.values()];
}
export async function retrieveEntities(
  db: DB,
  analysisId: string,
  version: number,
  chapter: number,
  text: string,
) {
  const records = await registry(db, analysisId, version);
  const scores = bm25(
    text,
    records.map((r) => `${r.entity.name} ${r.entity.aliases.join(' ')} ${r.entity.description}`),
  );
  const hits = records.map((r, i) => ({
    ...r,
    score: scores[i],
    name: text.includes(r.entity.name) || r.entity.aliases.some((a) => text.includes(a)),
  }));
  const mandatory = hits
    .filter((r) => r.name)
    .sort((a, b) => a.entity.id.localeCompare(b.entity.id));
  const recent = hits
    .filter((r) => !r.name && r.chapter >= chapter - 5)
    .sort((a, b) => b.unit - a.unit)
    .slice(0, 20);
  const search = hits
    .filter((r) => !r.name && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const candidates: ReferenceEntityData[] = [],
    reasons: Record<string, string> = {};
  let chars = 0;
  for (const [kind, group] of [
    ['NAME', mandatory],
    ['RECENT', recent],
    ['SEARCH', search],
  ] as const)
    for (const r of group) {
      if (reasons[r.entity.id]) continue;
      const size = [...JSON.stringify(r.entity)].length;
      if (candidates.length >= 60 || chars + size > 12000) {
        requireThat(
          kind !== 'NAME',
          'ENTITY_CONTEXT_TOO_LARGE',
          '同名实体候选超出容量，请缩小分析切分',
        );
        continue;
      }
      candidates.push(r.entity);
      reasons[r.entity.id] = kind;
      chars += size;
    }
  return { registryVersion: version, candidates, reasons, textHash: hash(text) };
}
export function validateReferenceResult(
  raw: unknown,
  sourceText: string,
  textId: string,
  start: number,
  end: number,
  candidates: ReferenceEntityData[],
  remap = true,
  primaryStart = start,
) {
  let result = referenceResultSchema.parse(raw);
  if (remap) result = remapProposal(result, identifiers({ candidates, textId }));
  const chars = [...sourceText];
  function walk(x: any) {
    if (!x || typeof x !== 'object') return;
    if ('textVersionId' in x)
      requireThat(
        x.textVersionId === textId &&
          x.start >= start &&
          x.end <= end &&
          x.start < x.end &&
          chars.slice(x.start, x.end).join('') === x.quote,
        'INVALID_REFERENCE',
        '分析证据必须精确对应本单元原文',
      );
    for (const v of Object.values(x))
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
  }
  walk(result);
  const entityIds = new Set([...candidates.map((e) => e.id), ...result.entities.map((e) => e.id)]);
  const eventIds = new Set(result.events.map((e) => e.id)),
    sceneIds = new Set(result.scenes.map((e) => e.id)),
    timeIds = new Set(result.timeline.map((e) => e.id));
  const seen = new Set<string>();
  for (const list of [
    result.entities,
    result.events,
    result.scenes,
    result.beats,
    result.hooks,
    result.timeline,
    result.promises,
  ])
    for (const x of list) {
      requireThat(!seen.has(x.id), 'INVALID_REFERENCE', '分析身份重复');
      seen.add(x.id);
    }
  const refs = (ids: string[], allowed: Set<string>) =>
    requireThat(
      ids.every((id) => allowed.has(id)),
      'INVALID_REFERENCE',
      '分析引用缺失或来自未来单元',
    );
  result.events.forEach((e, i) => {
    requireThat(
      e.evidence.start >= primaryStart,
      'INVALID_REFERENCE',
      '重叠区仅供理解，不可重复提取前一单元事件',
    );
    refs(e.actorIds, entityIds);
    if (e.sceneId) refs([e.sceneId], sceneIds);
    requireThat(e.sequence === i, 'INVALID_REFERENCE', '事件顺序须从0连续编号');
  });
  result.scenes.forEach((e) => {
    refs(e.participantIds, entityIds);
    if (e.locationId) refs([e.locationId], entityIds);
    if (e.timeId) refs([e.timeId], timeIds);
  });
  result.beats.forEach((e) => refs(e.eventIds, eventIds));
  result.stateChanges.forEach((e) => {
    refs([e.entityId], entityIds);
    refs([e.eventId], eventIds);
  });
  result.hooks.forEach((e) => {
    if (e.resolvedAtEventId) refs([e.resolvedAtEventId], eventIds);
  });
  result.timeline.forEach((e) => {
    refs([...e.beforeIds, ...e.afterIds], timeIds);
    requireThat(
      !e.beforeIds.includes(e.id) && !e.afterIds.includes(e.id),
      'INVALID_REFERENCE',
      '时间不能引用自身',
    );
  });
  const edges = new Map(result.timeline.map((e) => [e.id, [...e.beforeIds]]));
  for (const e of result.timeline)
    for (const predecessor of e.afterIds) edges.get(predecessor)!.push(e.id);
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    requireThat(!visiting.has(id), 'INVALID_REFERENCE', '时间线先后关系不能成环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) || []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of timeIds) visit(id);
  for (const e of result.entities) {
    const old = candidates.find((c) => c.id === e.id);
    requireThat(
      !old || (old.kind === e.kind && old.name === e.name),
      'INVALID_REFERENCE',
      '已有实体类型与规范名称不可被模型改写',
    );
    for (const alias of [
      ...(!old ? [e.name] : []),
      ...e.aliases.filter((a) => !old?.aliases.includes(a)),
    ])
      requireThat(
        e.evidence.some((s) => s.quote.includes(alias)),
        'INVALID_REFERENCE',
        '名称与新增别名必须有正文证据',
      );
    const matches = candidates.filter(
      (c) =>
        c.id !== e.id && c.kind === e.kind && (c.name === e.name || c.aliases.includes(e.name)),
    );
    if (!old && matches.length && !result.unresolvedIdentities.some((u) => u.candidateId === e.id))
      result.unresolvedIdentities.push({
        candidateId: e.id,
        possibleEntityIds: matches.map((m) => m.id),
        reason: '同名身份需要确认，系统没有自动合并',
      });
  }
  for (const u of result.unresolvedIdentities) {
    refs([u.candidateId, ...u.possibleEntityIds], entityIds);
    requireThat(
      result.entities.some((e) => e.id === u.candidateId),
      'INVALID_REFERENCE',
      '待整理候选必须在当前单元',
    );
  }
  return result;
}
