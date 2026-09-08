import {
  allowedQuoteSchema,
  assetPackSchema,
  frameworkSchema,
  quoteAuthorizationInputSchema,
  type AuthorizedQuote,
} from '@one2novel/contracts';
import type { DB, Tx } from '../platform/db.js';
import { hash, normalize, requireThat, uuid } from '../platform/core.js';
import { publishedModel, resolveKnowledge, type KnowledgeContext } from '../knowledge/library.js';

function rowToQuote(row: {
  id: string;
  projectId: string;
  text: string;
  sourceKind: string;
  sourceId: string;
  sourceVersionId: string;
  createdAt: Date | string;
}): AuthorizedQuote {
  return {
    id: row.id,
    projectId: row.projectId,
    text: row.text,
    sourceRef: { kind: row.sourceKind, id: row.sourceId, versionId: row.sourceVersionId },
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

async function sourceAnalysisIds(db: DB | Tx, knowledge: KnowledgeContext) {
  const ids = new Set<string>();
  for (const item of knowledge.items) {
    if (item.kind === 'FRAMEWORK') ids.add(frameworkSchema.parse(item.payload).sourceModelVersionId);
    if (item.kind === 'ASSET_PACK') {
      let payload = assetPackSchema.parse(item.payload);
      for (let step = 0; step < 3 && payload.stage !== 'RAW'; step++) {
        const previous = await db.knowledgeVersion.findUniqueOrThrow({
          where: { id: payload.sourceVersionId },
        });
        payload = assetPackSchema.parse(previous.payload);
      }
      if (payload.stage === 'RAW') ids.add(payload.sourceVersionId);
    }
  }
  return ids;
}

export async function resolveAuthorizedQuotes(db: DB | Tx, projectId: string) {
  const rows = await db.authorizedQuote.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const items = rows.map(rowToQuote);
  items.forEach((q) => allowedQuoteSchema.parse({ text: q.text, sourceRef: q.sourceRef }));
  return { items, hash: hash(items.map((q) => [q.id, q.text, q.sourceRef])) };
}

export async function authorizeQuote(db: DB, projectId: string, raw: unknown) {
  const input = quoteAuthorizationInputSchema.parse(raw);
  const quoteText = normalize(input.text);
  requireThat(quoteText.length >= 80, 'QUOTE_TOO_SHORT', '引用豁免至少需要80个字符');
  requireThat(input.sourceRef.kind === 'REFERENCE_ANALYSIS', 'INVALID_REFERENCE', '引用来源必须是已发布参考分析');
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    requireThat(p.revision === input.expectedRevision, 'REVISION_CONFLICT', '小说已更新，请刷新', 409);
    requireThat(
      !(await tx.activeCommand.findUnique({ where: { projectId } })),
      'PROJECT_BUSY',
      '请等待当前任务结束',
      409,
    );
    const knowledge = await resolveKnowledge(tx, projectId);
    requireThat(
      (await sourceAnalysisIds(tx, knowledge)).has(input.sourceRef.versionId),
      'REFERENCE_NOT_BOUND',
      '只能授权当前小说已绑定知识来源中的参考文本',
    );
    const analysis = await publishedModel(tx, input.sourceRef.versionId);
    requireThat(
      analysis.sourceId === input.sourceRef.id && analysis.source.text.includes(quoteText),
      'INVALID_REFERENCE',
      '授权文本必须精确存在于来源参考原文',
    );
    const existing = await tx.authorizedQuote.findUnique({
      where: {
        projectId_text_sourceVersionId: {
          projectId,
          text: quoteText,
          sourceVersionId: input.sourceRef.versionId,
        },
      },
    });
    if (existing) return rowToQuote(existing);
    const row = await tx.authorizedQuote.create({
      data: {
        id: uuid(),
        projectId,
        text: quoteText,
        sourceKind: input.sourceRef.kind,
        sourceId: input.sourceRef.id,
        sourceVersionId: input.sourceRef.versionId,
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return rowToQuote(row);
  });
}
