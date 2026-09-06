import { z } from 'zod';
import {
  frameworkSchema,
  assetPackSchema,
  styleSchema,
  templateSchema,
  narrativeFunction,
  type KnowledgeKind,
  type ReferenceResult,
  type ReferenceEntityData,
  type Opening,
} from '@one2novel/contracts';
import type { DB, Tx } from '../platform/db.js';
import { asJson, hash, identifiers, requireThat, uuid } from '../platform/core.js';
import { registry } from '../reference/analysis.js';

export function knowledgePayload(kind: KnowledgeKind, payload: unknown) {
  const value = (
    {
      FRAMEWORK: frameworkSchema,
      ASSET_PACK: assetPackSchema,
      STYLE: styleSchema,
      TEMPLATE: templateSchema,
    }[kind] as z.ZodType
  ).parse(payload) as any;
  if (kind === 'STYLE')
    requireThat(
      value.dialogueRatio[0] <= value.dialogueRatio[1],
      'INVALID_KNOWLEDGE',
      '对白比例范围倒置',
    );
  if (kind === 'TEMPLATE') {
    requireThat(
      value.schemaId === value.target,
      'INVALID_KNOWLEDGE',
      '模板schemaId必须与目标层级一致',
    );
    // Templates contain optional generation guidance, never identities, references or runtime settings.
    const allowed = [
      'summary',
      'premise',
      'centralQuestion',
      'endingDirection',
      'entrySituation',
      'exitGoal',
      'trigger',
      'opposition',
      'turn',
      'resolutionTarget',
    ];
    requireThat(
      Object.entries(value.defaults).every(
        ([key, v]) => allowed.includes(key) && typeof v === 'string',
      ),
      'INVALID_KNOWLEDGE',
      '模板默认值只能包含已有描述字段',
    );
  }
  if (kind === 'FRAMEWORK') {
    const ids = new Set(value.nodes.map((n: any) => n.id));
    requireThat(ids.size === value.nodes.length, 'INVALID_KNOWLEDGE', '结构节点重复');
    const active = new Set<string>(),
      done = new Set<string>();
    const visit = (nodeId: string) => {
      requireThat(
        ids.has(nodeId) && !active.has(nodeId),
        'INVALID_KNOWLEDGE',
        '结构节点引用缺失或循环',
      );
      if (done.has(nodeId)) return;
      active.add(nodeId);
      const node = value.nodes.find((n: any) => n.id === nodeId);
      requireThat(node.position[0] <= node.position[1], 'INVALID_KNOWLEDGE', '节点位置倒置');
      node.prerequisiteNodeIds.forEach(visit);
      active.delete(nodeId);
      done.add(nodeId);
    };
    value.nodes.forEach((n: any) => visit(n.id));
    requireThat(
      value.cycles.every((c: any) => c.nodeIds.every((id: string) => ids.has(id))),
      'INVALID_KNOWLEDGE',
      '循环模式引用缺失',
    );
  }
  if (kind === 'ASSET_PACK') {
    const ids = new Set(value.assets.map((a: any) => a.id));
    requireThat(
      ids.size === value.assets.length &&
        value.assets.every((a: any) => a.relationAssetIds.every((id: string) => ids.has(id))),
      'INVALID_KNOWLEDGE',
      '素材身份或关系引用无效',
    );
    if (value.stage === 'ADAPTED')
      requireThat(
        value.adaptationBrief?.trim() &&
          value.mapping.length === value.assets.length &&
          new Set(value.mapping.map((m: any) => m.newId)).size === value.assets.length &&
          value.assets.every((a: any) =>
            value.mapping.some((m: any) => m.newId === a.id && m.oldId === a.originAssetId),
          ),
        'INVALID_KNOWLEDGE',
        '改编必须包含逐项来源映射和改动说明',
      );
  }
  return value;
}
export async function appendKnowledge(
  tx: Tx,
  itemId: string,
  payload: unknown,
  revision: number,
  sourceVersionId: string | null,
) {
  const item = await tx.knowledgeItem.findUniqueOrThrow({ where: { id: itemId } });
  requireThat(item.revision === revision, 'REVISION_CONFLICT', '知识已更新，请刷新', 409);
  const value = knowledgePayload(item.kind as KnowledgeKind, payload);
  const last = await tx.knowledgeVersion.findFirst({
    where: { itemId },
    orderBy: { number: 'desc' },
  });
  const version = await tx.knowledgeVersion.create({
    data: {
      id: uuid(),
      itemId,
      number: (last?.number || 0) + 1,
      payload: asJson(value),
      hash: hash(value),
      sourceVersionId,
    },
  });
  await tx.knowledgeItem.update({ where: { id: itemId }, data: { revision: { increment: 1 } } });
  return version;
}
export async function publishedModel(db: DB | Tx, id: string) {
  const analysis = await db.referenceAnalysis.findUniqueOrThrow({
    where: { id },
    include: { units: { orderBy: { number: 'asc' } }, split: true, source: true },
  });
  requireThat(
    analysis.status === 'COMPLETE' &&
      analysis.publishedAt &&
      analysis.completedChars === analysis.totalChars,
    'REFERENCE_INCOMPLETE',
    '只能使用已完整分析并发布的参考版本',
  );
  return analysis;
}
export async function deriveKnowledge(
  db: DB | Tx,
  analysisId: string,
  kind: 'FRAMEWORK' | 'ASSET_PACK',
) {
  const model = await publishedModel(db, analysisId);
  if (kind === 'ASSET_PACK') {
    const records = await registry(db, model.id, model.registryHead);
    const observations = await db.referenceEntity.findMany({
      where: { analysisId: model.id, throughUnit: { lte: model.registryHead } },
      orderBy: { throughUnit: 'asc' },
    });
    return {
      stage: 'RAW',
      assets: records.map(({ entity }) => ({
        id: uuid(),
        kind: entity.kind,
        name: entity.name,
        description: entity.description,
        attributes: {},
        relationAssetIds: [],
        sourceSpans: [
          ...new Map(
            observations
              .filter((r) => r.entityId === entity.id)
              .flatMap((r) => (r.payload as ReferenceEntityData).evidence)
              .map((s) => [hash(s), s]),
          ).values(),
        ],
        originAssetId: null,
      })),
      sourceVersionId: model.id,
      adaptationBrief: null,
      mapping: [],
    };
  }
  const count = (model.split.payload as any[]).length;
  const beats = model.units.flatMap((u) =>
    (u.payload as ReferenceResult).beats.map((b) => ({ ...b, chapter: u.chapterNo })),
  );
  const functions = narrativeFunction.options;
  const climax = [
    ...new Set(beats.filter((b) => b.function === 'CLIMAX').map((b) => b.chapter)),
  ].sort((a, b) => a - b);
  const hooks = new Set(
    model.units.filter((u) => (u.payload as ReferenceResult).hooks.length).map((u) => u.chapterNo),
  );
  return {
    sourceModelVersionId: model.id,
    nodes: beats.map((b) => ({
      id: uuid(),
      position: [(b.chapter - 1) / count, b.chapter / count],
      function: b.function,
      sourceSummary: b.summary,
      prerequisiteNodeIds: [],
      expectedEffects: [b.emotionAfter.label],
      beatFunctions: [b.function],
    })),
    cycles: [],
    curves: beats.map((b) => ({
      position: b.chapter / count,
      intensity: b.intensity,
      valence: b.emotionAfter.valence,
      arousal: b.emotionAfter.arousal,
    })),
    statistics: {
      climaxGapMean: climax.length < 2 ? null : (climax.at(-1)! - climax[0]) / (climax.length - 1),
      hookRate: hooks.size / count,
      beatDistribution: Object.fromEntries(
        functions.map((f) => [
          f,
          beats.filter((b) => b.function === f).length / (beats.length || 1),
        ]),
      ),
    },
  };
}
export function cleanAssets(raw: unknown) {
  const pack = assetPackSchema.parse(raw);
  requireThat(pack.stage === 'RAW', 'INVALID_KNOWLEDGE', '只从原始素材创建清洗版本');
  const seen = new Map<string, string>(),
    redirects = new Map<string, string>();
  const assets = pack.assets.filter((a) => {
    const key = hash([
      a.kind,
      a.name.normalize('NFC').trim(),
      a.description.normalize('NFC').trim(),
    ]);
    const old = seen.get(key);
    if (old) {
      redirects.set(a.id, old);
      const original = pack.assets.find((x) => x.id === old)!;
      original.sourceSpans = [
        ...new Map([...original.sourceSpans, ...a.sourceSpans].map((s) => [hash(s), s])).values(),
      ];
      original.relationAssetIds = [
        ...new Set([...original.relationAssetIds, ...a.relationAssetIds]),
      ];
      return false;
    }
    seen.set(key, a.id);
    return true;
  });
  for (const a of assets)
    a.relationAssetIds = [...new Set(a.relationAssetIds.map((id) => redirects.get(id) || id))];
  return { ...pack, stage: 'CLEAN', assets };
}
export async function validateKnowledgeSources(
  db: DB | Tx,
  kind: KnowledgeKind,
  payload: any,
  sourceId: string | null,
) {
  payload = knowledgePayload(kind, payload);
  if (kind === 'STYLE' || kind === 'TEMPLATE') return;
  if (kind === 'FRAMEWORK') {
    requireThat(payload.sourceModelVersionId === sourceId, 'INVALID_REFERENCE', '框架来源不匹配');
    const derived = await deriveKnowledge(db, sourceId!, 'FRAMEWORK');
    requireThat(
      hash(payload.statistics) === hash(derived.statistics),
      'INVALID_KNOWLEDGE',
      '框架统计由完整参考版本计算，不可手工改写',
    );
    return;
  }
  requireThat(payload.sourceVersionId === sourceId, 'INVALID_REFERENCE', '素材来源版本不匹配');
  if (payload.stage === 'RAW') {
    const source = await publishedModel(db, sourceId!);
    const chars = [...source.source.text];
    for (const asset of payload.assets)
      for (const span of asset.sourceSpans)
        requireThat(
          span.textVersionId === source.source.textId &&
            span.start < span.end &&
            chars.slice(span.start, span.end).join('') === span.quote,
          'INVALID_REFERENCE',
          '素材来源证据不匹配参考原文',
        );
    return;
  }
  const previous = await db.knowledgeVersion.findUniqueOrThrow({ where: { id: sourceId! } });
  requireThat(
    previous.publishedAt && hash(previous.payload) === previous.hash,
    'INVALID_REFERENCE',
    '素材前置版本未发布或已损坏',
  );
  const old = assetPackSchema.parse(previous.payload);
  requireThat(
    old.stage === (payload.stage === 'CLEAN' ? 'RAW' : 'CLEAN'),
    'INVALID_KNOWLEDGE',
    '素材必须经过原始、清洗、改编三个阶段',
  );
  const oldIds = new Set(old.assets.map((a) => a.id));
  if (payload.stage === 'CLEAN')
    for (const asset of payload.assets) {
      const original = old.assets.find((a) => a.id === asset.id);
      const equivalent = old.assets.filter(
        (a) =>
          a.kind === asset.kind && a.name === asset.name && a.description === asset.description,
      );
      requireThat(
        original &&
          original.kind === asset.kind &&
          original.name === asset.name &&
          original.description === asset.description &&
          asset.sourceSpans.every((s: any) =>
            equivalent.some((a) => a.sourceSpans.some((p) => hash(p) === hash(s))),
          ),
        'INVALID_KNOWLEDGE',
        '清洗只能整理、排除与去重，改写素材请使用改编',
      );
    }
  if (payload.stage === 'ADAPTED')
    for (const a of payload.assets) {
      const origin = old.assets.find((x) => x.id === a.originAssetId);
      requireThat(
        origin &&
          !oldIds.has(a.id) &&
          a.kind === origin.kind &&
          (a.kind !== 'CHARACTER' ||
            !old.assets.some((x) => x.kind === 'CHARACTER' && x.name.trim() === a.name.trim())),
        'INVALID_KNOWLEDGE',
        '改编身份无效，核心人物不能沿用原名',
      );
      requireThat(
        a.sourceSpans.every((s: any) => origin.sourceSpans.some((p) => hash(p) === hash(s))),
        'INVALID_REFERENCE',
        '改编来源证据不能被伪造',
      );
    }
}
export async function referenceTexts(db: DB, knowledge: KnowledgeContext) {
  const ids = new Set<string>();
  for (const item of knowledge.items) {
    if (item.kind === 'FRAMEWORK') ids.add(item.payload.sourceModelVersionId);
    if (item.kind === 'ASSET_PACK') {
      let payload = item.payload;
      for (let step = 0; step < 3 && payload.stage !== 'RAW'; step++) {
        const previous = await db.knowledgeVersion.findUniqueOrThrow({
          where: { id: payload.sourceVersionId },
        });
        requireThat(hash(previous.payload) === previous.hash, 'INVALID_REFERENCE', '知识来源损坏');
        payload = assetPackSchema.parse(previous.payload);
      }
      requireThat(payload.stage === 'RAW', 'INVALID_REFERENCE', '素材来源链不完整');
      ids.add(payload.sourceVersionId);
    }
  }
  const sources = await Promise.all([...ids].map((id) => publishedModel(db, id)));
  return sources.map((s) => s.source.text);
}
export type KnowledgeContext = {
  items: { versionId: string; kind: KnowledgeKind; hash: string; payload: any }[];
  hash: string;
};
export function validateOpeningKnowledge(opening: Opening, knowledge: KnowledgeContext) {
  requireThat(
    hash([...opening.book.knowledgeVersionIds].sort()) ===
      hash(knowledge.items.map((i) => i.versionId).sort()),
    'STALE_INPUT',
    '知识绑定已变化，请重新生成开书方案',
    409,
  );
  const sourceNodes = knowledge.items
    .filter((i) => i.kind === 'FRAMEWORK')
    .flatMap((i) => i.payload.nodes as { id: string }[]);
  requireThat(
    !sourceNodes.length || opening.adaptationMap.length > 0,
    'KNOWLEDGE_NOT_APPLIED',
    '绑定框架后需要说明叙事功能如何改编',
  );
  requireThat(
    opening.adaptationMap.every(
      (m) =>
        sourceNodes.some((n) => n.id === m.sourceNodeId) && m.newPlanNodeId === opening.book.id,
    ),
    'INVALID_REFERENCE',
    '框架改编映射引用错误',
  );
  const knowledgeIds = identifiers(knowledge);
  requireThat(
    Object.keys(opening.state.entities).every((id) => !knowledgeIds.has(id)),
    'INVALID_REFERENCE',
    '参考素材不能直接成为新小说事实身份',
  );
}
export async function resolveKnowledge(db: DB | Tx, projectId: string): Promise<KnowledgeContext> {
  const bindings = await db.knowledgeBinding.findMany({
    where: { projectId },
    include: { version: { include: { item: true } } },
    orderBy: { versionId: 'asc' },
  });
  const items = bindings.map(({ version: v }) => {
    requireThat(
      v.publishedAt && hash(v.payload) === v.hash,
      'INVALID_KNOWLEDGE',
      '知识绑定版本未发布或已损坏',
    );
    const payload = knowledgePayload(v.item.kind as KnowledgeKind, v.payload);
    requireThat(
      v.item.kind !== 'ASSET_PACK' || payload.stage === 'ADAPTED',
      'RAW_ASSET_BINDING',
      '只有已改编素材可绑定小说',
    );
    return { versionId: v.id, kind: v.item.kind as KnowledgeKind, hash: v.hash, payload };
  });
  for (const [kind, limit] of [
    ['FRAMEWORK', 1],
    ['ASSET_PACK', 3],
    ['STYLE', 1],
  ] as const)
    requireThat(
      items.filter((i) => i.kind === kind).length <= limit,
      'INVALID_BINDINGS',
      `${kind}绑定数量超过限制`,
    );
  const templates = items.filter((i) => i.kind === 'TEMPLATE');
  requireThat(
    new Set(templates.map((i) => i.payload.target)).size === templates.length,
    'INVALID_BINDINGS',
    '每个规划层级只能绑定一个模板',
  );
  return { items, hash: hash(items.map((i) => [i.versionId, i.hash])) };
}
export async function bindKnowledge(
  db: DB,
  projectId: string,
  versionIds: string[],
  revision: number,
) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    requireThat(p.revision === revision, 'REVISION_CONFLICT', '小说已变化，请刷新', 409);
    requireThat(
      !(await tx.activeCommand.findUnique({ where: { projectId } })),
      'PROJECT_BUSY',
      '请先停止当前小说任务',
      409,
    );
    requireThat(
      new Set(versionIds).size === versionIds.length && versionIds.length <= 9,
      'INVALID_BINDINGS',
      '绑定重复或超过数量限制',
    );
    await tx.knowledgeBinding.deleteMany({ where: { projectId } });
    for (const versionId of versionIds)
      await tx.knowledgeBinding.create({ data: { id: uuid(), projectId, versionId } });
    const context = await resolveKnowledge(tx, projectId);
    const requirements = p.requirements as { must: string[] };
    const banned = context.items
      .filter((i) => i.kind === 'STYLE')
      .flatMap((i) => i.payload.bannedPhrases as string[]);
    requireThat(
      !requirements.must.some((r) => banned.some((b) => r.includes(b))),
      'KNOWLEDGE_CONFLICT',
      '必需要求与知识禁用词冲突',
    );
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return context;
  });
}
