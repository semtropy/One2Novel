import { z } from 'zod';
import type { DB } from '../platform/db.js';
import { freezeConfig } from './config.js';
import { validateSplit } from '../reference/import.js';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';

export const libraryRequest = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('ANALYZE'),
    sourceId: z.string().uuid(),
    splitId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    operation: z.enum(['FRAMEWORK', 'RAW', 'CLEAN', 'ADAPT']),
    sourceVersionId: z.string().uuid(),
    title: z.string().min(1).max(100),
    itemId: z.string().uuid().nullable().default(null),
    expectedRevision: z.number().int().nonnegative().default(0),
    brief: z.string().max(4000).default(''),
  }),
]);
export async function startLibrary(db: DB, ready: boolean, raw: unknown, key: string) {
  const input = libraryRequest.parse(raw),
    config = await freezeConfig(db);
  if (input.operation === 'ANALYZE' || input.operation === 'ADAPT')
    requireThat(ready, 'MODEL_NOT_CONFIGURED', '请先配置ChatAnyWhere服务端密钥', 503);
  if (input.operation === 'ADAPT')
    requireThat(input.brief.trim(), 'INVALID_KNOWLEDGE', '请填写改编要求');
  const receiptScope = 'library:' + input.operation,
    requestHash = hash(input);
  return db.$transaction(
    async (tx) => {
      const existing = await tx.receipt.findUnique({
        where: { scope_key: { scope: receiptScope, key } },
      });
      if (existing) {
        requireThat(
          existing.requestHash === requestHash,
          'IDEMPOTENCY_CONFLICT',
          '请求键已用于不同输入',
          409,
        );
        return tx.job.findUniqueOrThrow({
          where: { id: (existing.response as { id: string }).id },
        });
      }
      let scope: string,
        jobInput: Record<string, unknown>,
        itemId: string | null = null;
      if (input.operation === 'ANALYZE') {
        const source = await tx.referenceSource.findUniqueOrThrow({
          where: { id: input.sourceId },
        });
        const split = await tx.referenceSplit.findUniqueOrThrow({ where: { id: input.splitId } });
        requireThat(
          source.revision === input.expectedRevision &&
            source.activeSplitId === split.id &&
            split.sourceId === source.id &&
            split.publishedAt &&
            hash(split.payload) === split.hash,
          'REVISION_CONFLICT',
          '请先发布当前切分版本',
          409,
        );
        scope = `reference:${source.id}`;
        jobInput = { ...input, scope };
      } else {
        itemId = input.itemId || uuid();
        scope = `knowledge:${itemId}`;
        if (!input.itemId)
          await tx.knowledgeItem.create({
            data: {
              id: itemId,
              kind: input.operation === 'FRAMEWORK' ? 'FRAMEWORK' : 'ASSET_PACK',
              title: input.title,
            },
          });
        const item = await tx.knowledgeItem.findUniqueOrThrow({ where: { id: itemId } });
        requireThat(
          item.revision === input.expectedRevision,
          'REVISION_CONFLICT',
          '知识已变化',
          409,
        );
        requireThat(
          item.kind === (input.operation === 'FRAMEWORK' ? 'FRAMEWORK' : 'ASSET_PACK'),
          'INVALID_KNOWLEDGE',
          '知识类型不匹配',
        );
        jobInput = { ...input, itemId, scope, revision: item.revision };
      }
      requireThat(
        !(await tx.libraryCommand.findUnique({ where: { scope } })),
        'PROJECT_BUSY',
        '该参考或知识已有活动任务',
        409,
      );
      const job = await tx.job.create({
        data: {
          id: uuid(),
          projectId: null,
          kind: input.operation === 'ANALYZE' ? 'REFERENCE_ANALYSIS' : 'KNOWLEDGE_BUILD',
          chainEpoch: 0,
          input: asJson(jobInput),
          config: asJson(config),
          artifactRefs: {},
          httpLimit: 100,
        },
      });
      await tx.libraryCommand.create({ data: { scope, jobId: job.id } });
      if (input.operation === 'ANALYZE') {
        const source = await tx.referenceSource.findUniqueOrThrow({
            where: { id: input.sourceId },
          }),
          split = await tx.referenceSplit.findUniqueOrThrow({ where: { id: input.splitId } });
        const chars = [...source.text],
          chapters = validateSplit(split.payload, chars.length);
        const analysis = await tx.referenceAnalysis.create({
          data: {
            id: uuid(),
            sourceId: source.id,
            splitId: split.id,
            jobId: job.id,
            totalChars: chars.length,
          },
        });
        let number = 0;
        for (const c of chapters)
          for (let start = c.start; start < c.end; start += 6000) {
            const end = Math.min(c.end, start + 6000),
              inputStart = Math.max(c.start, start - 300);
            await tx.referenceUnit.create({
              data: {
                id: uuid(),
                analysisId: analysis.id,
                number: ++number,
                chapterNo: c.order,
                start,
                end,
                inputStart,
                registryVersion: number - 1,
                inputHash: hash([
                  chars.slice(inputStart, end).join(''),
                  start,
                  end,
                  split.id,
                  hash(config),
                ]),
              },
            });
          }
      }
      await tx.receipt.create({
        data: { id: uuid(), scope: receiptScope, key, requestHash, response: { id: job.id } },
      });
      return job;
    },
    { timeout: 30000 },
  );
}
