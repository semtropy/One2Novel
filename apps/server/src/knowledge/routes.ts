import type { Express, Response } from 'express';
import { z } from 'zod';
import { id, json, knowledgeKind, text } from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import type { Orchestrator } from '../orchestrator/service.js';
import { hash, requireThat, uuid } from '../platform/core.js';
import {
  appendKnowledge,
  knowledgePayload,
  bindKnowledge,
  resolveKnowledge,
  validateKnowledgeSources,
} from './library.js';
import { startLibrary } from '../orchestrator/library-commands.js';

export function knowledgeRoutes(app: Express, db: DB, engine: Orchestrator) {
  const send = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ data, requestId: res.locals.requestId });
  app.get('/api/v1/knowledge', async (_req, res) =>
    send(
      res,
      await db.knowledgeItem.findMany({
        include: { versions: { orderBy: { number: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  );
  app.get('/api/v1/knowledge/:id', async (req, res) => {
    const item = await db.knowledgeItem.findUniqueOrThrow({
      where: { id: id.parse(req.params.id) },
      include: { versions: { orderBy: { number: 'desc' } } },
    });
    const jobs = await db.job.findMany({
      where: { projectId: null, kind: 'KNOWLEDGE_BUILD' },
      orderBy: { createdAt: 'desc' },
    });
    send(res, {
      ...item,
      jobs: jobs.filter((j) => (j.input as { itemId: string }).itemId === item.id),
    });
  });
  app.post('/api/v1/knowledge', async (req, res) => {
    const b = z
      .strictObject({
        kind: knowledgeKind,
        title: text.min(1).max(100),
        sourceVersionId: id.nullable().default(null),
        payload: json.optional(),
      })
      .parse(req.body);
    if (b.kind === 'FRAMEWORK' || b.kind === 'ASSET_PACK') {
      requireThat(b.sourceVersionId, 'INVALID_REFERENCE', '请选择完整发布的参考版本');
      send(
        res,
        await startLibrary(
          db,
          engine.modelReady(),
          {
            operation: b.kind === 'FRAMEWORK' ? 'FRAMEWORK' : 'RAW',
            sourceVersionId: b.sourceVersionId,
            title: b.title,
          },
          id.parse(req.get('idempotency-key')),
        ),
        202,
      );
    } else
      send(
        res,
        await db.$transaction(async (tx) => {
          const item = await tx.knowledgeItem.create({
            data: { id: uuid(), kind: b.kind, title: b.title },
          });
          await appendKnowledge(tx, item.id, b.payload, 0, null);
          return tx.knowledgeItem.findUniqueOrThrow({ where: { id: item.id } });
        }),
        201,
      );
  });
  app.post('/api/v1/knowledge/:id/versions', async (req, res) => {
    const b = z
        .strictObject({ payload: json, expectedRevision: z.number().int().nonnegative() })
        .parse(req.body),
      itemId = id.parse(req.params.id);
    send(
      res,
      await db.$transaction(async (tx) => {
        const item = await tx.knowledgeItem.findUniqueOrThrow({ where: { id: itemId } });
        requireThat(
          !(await tx.libraryCommand.findUnique({ where: { scope: `knowledge:${itemId}` } })),
          'PROJECT_BUSY',
          '知识转换进行中',
          409,
        );
        const payload = knowledgePayload(item.kind as any, b.payload) as any,
          sourceId = payload.sourceModelVersionId || payload.sourceVersionId || null;
        await validateKnowledgeSources(tx, item.kind as any, payload, sourceId);
        return appendKnowledge(tx, itemId, payload, b.expectedRevision, sourceId);
      }),
      201,
    );
  });
  app.post('/api/v1/knowledge/:id/publish', async (req, res) => {
    const b = z
        .strictObject({ versionId: id, expectedRevision: z.number().int().nonnegative() })
        .parse(req.body),
      itemId = id.parse(req.params.id);
    send(
      res,
      await db.$transaction(async (tx) => {
        const item = await tx.knowledgeItem.findUniqueOrThrow({ where: { id: itemId } }),
          v = await tx.knowledgeVersion.findUniqueOrThrow({ where: { id: b.versionId } });
        requireThat(
          item.revision === b.expectedRevision &&
            v.itemId === itemId &&
            hash(v.payload) === v.hash &&
            !(await tx.libraryCommand.findUnique({ where: { scope: `knowledge:${itemId}` } })),
          'REVISION_CONFLICT',
          '知识版本已变化或正在转换',
          409,
        );
        await validateKnowledgeSources(tx, item.kind as any, v.payload, v.sourceVersionId);
        await tx.knowledgeVersion.update({
          where: { id: v.id },
          data: { publishedAt: v.publishedAt || new Date() },
        });
        return tx.knowledgeItem.update({
          where: { id: itemId },
          data: { activeVersionId: v.id, revision: { increment: 1 } },
        });
      }),
    );
  });
  for (const action of ['clean', 'adapt'] as const)
    app.post(`/api/v1/knowledge/:id/${action}`, async (req, res) => {
      const b = z
        .strictObject({
          sourceVersionId: id,
          expectedRevision: z.number().int().nonnegative(),
          adaptationBrief: text.max(4000).default(''),
        })
        .parse(req.body);
      const item = await db.knowledgeItem.findUniqueOrThrow({
        where: { id: id.parse(req.params.id) },
      });
      send(
        res,
        await startLibrary(
          db,
          engine.modelReady(),
          {
            operation: action === 'clean' ? 'CLEAN' : 'ADAPT',
            sourceVersionId: b.sourceVersionId,
            title: item.title,
            itemId: item.id,
            expectedRevision: b.expectedRevision,
            brief: b.adaptationBrief,
          },
          id.parse(req.get('idempotency-key')),
        ),
        202,
      );
    });
  app.get('/api/v1/projects/:id/knowledge-bindings', async (req, res) =>
    send(res, await resolveKnowledge(db, id.parse(req.params.id))),
  );
  app.put('/api/v1/projects/:id/knowledge-bindings', async (req, res) => {
    const b = z
      .strictObject({
        versionIds: z.array(id).max(9),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(req.body);
    send(res, await bindKnowledge(db, id.parse(req.params.id), b.versionIds, b.expectedRevision));
  });
}
