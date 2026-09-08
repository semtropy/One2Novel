import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { id, text } from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import type { Orchestrator } from '../orchestrator/service.js';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';
import { parseImport, UPLOAD_LIMIT, validateSplit } from './import.js';
import { startLibrary } from '../orchestrator/library-commands.js';
import { resolveIdentities } from './resolve.js';
import { decodeUploadFilename, referenceDisplayTitle } from './filename.js';

export function referenceRoutes(app: Express, db: DB, engine: Orchestrator) {
  const send = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ data, requestId: res.locals.requestId });
  const meta = {
    id: true,
    title: true,
    format: true,
    encoding: true,
    revision: true,
    textId: true,
    textHash: true,
    activeSplitId: true,
    activeModelId: true,
    createdAt: true,
  } as const;
  app.post('/api/v1/references/:id/entity-resolutions', async (req, res) =>
    send(res, await resolveIdentities(db, id.parse(req.params.id), req.body), 201),
  );
  app.get('/api/v1/references', async (_req, res) =>
    send(
      res,
      (await db.referenceSource.findMany({ select: meta, orderBy: { createdAt: 'desc' } })).map(
        (source) => ({ ...source, title: referenceDisplayTitle(source.title) }),
      ),
    ),
  );
  app.post(
    '/api/v1/references',
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: UPLOAD_LIMIT, files: 1, fields: 3 },
    }).single('file'),
    async (req, res) => {
      requireThat(req.file, 'INVALID_FORMAT', '请选择TXT或EPUB文件');
      const encoding = z.enum(['UTF8', 'GB18030']).parse(req.body.encoding || 'UTF8');
      const filename = decodeUploadFilename(req.file.originalname);
      const parsed = await parseImport(req.file.buffer, filename, encoding);
      const result = await db.$transaction(async (tx) => {
        const duplicate = await tx.referenceSource.findUnique({
          where: { originalHash: parsed.originalHash },
          select: meta,
        });
        if (duplicate) return duplicate;
        const source = await tx.referenceSource.create({
          data: {
            id: uuid(),
            title: text
              .min(1)
              .max(200)
              .parse(req.body.title || filename),
            originalHash: parsed.originalHash,
            original: new Uint8Array(req.file!.buffer),
            format: parsed.format,
            encoding: parsed.encoding,
            textId: uuid(),
            text: parsed.text,
            textHash: hash(parsed.text),
          },
        });
        await tx.referenceSplit.create({
          data: {
            id: uuid(),
            sourceId: source.id,
            payload: asJson(parsed.chapters),
            hash: hash(parsed.chapters),
          },
        });
        return tx.referenceSource.findUniqueOrThrow({ where: { id: source.id }, select: meta });
      });
      send(res, { ...result, title: referenceDisplayTitle(result.title) }, 201);
    },
  );
  app.get('/api/v1/references/:id', async (req, res) => {
    const source = await db.referenceSource.findUniqueOrThrow({
      where: { id: id.parse(req.params.id) },
      select: {
        ...meta,
        splits: { orderBy: { createdAt: 'desc' } },
        analyses: {
          orderBy: { createdAt: 'desc' },
          include: { units: { orderBy: { number: 'asc' } } },
        },
      },
    });
    const jobs = await db.job.findMany({
      where: { id: { in: source.analyses.map((a) => a.jobId) } },
    });
    send(res, { ...source, title: referenceDisplayTitle(source.title), jobs });
  });
  app.get('/api/v1/references/:id/text', async (req, res) => {
    const source = await db.referenceSource.findUniqueOrThrow({
      where: { id: id.parse(req.params.id) },
    });
    const start = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(req.query.start || 0),
      end = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.query.end || 8000);
    requireThat(end > start && end - start <= 8000, 'INVALID_SPAN', '单次预览最多8000字符');
    send(res, {
      textVersionId: source.textId,
      start,
      text: [...source.text].slice(start, end).join(''),
      total: [...source.text].length,
    });
  });
  app.put('/api/v1/references/:id/split', async (req, res) => {
    const b = z
      .strictObject({
        expectedRevision: z.number().int().nonnegative(),
        chapters: z
          .array(
            z.strictObject({
              title: text.min(1).max(200),
              start: z.number().int().nonnegative(),
              end: z.number().int().positive(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    send(
      res,
      await db.$transaction(async (tx) => {
        const sourceId = id.parse(req.params.id),
          source = await tx.referenceSource.findUniqueOrThrow({ where: { id: sourceId } });
        requireThat(
          source.revision === b.expectedRevision &&
            !(await tx.libraryCommand.findUnique({ where: { scope: `reference:${sourceId}` } })),
          'REVISION_CONFLICT',
          '参考版本已变化或正在分析',
          409,
        );
        const chapters = validateSplit(
          b.chapters.map((c, i) => ({ ...c, id: uuid(), order: i + 1 })),
          [...source.text].length,
        );
        const split = await tx.referenceSplit.create({
          data: { id: uuid(), sourceId, payload: asJson(chapters), hash: hash(chapters) },
        });
        await tx.referenceSource.update({
          where: { id: sourceId },
          data: { revision: { increment: 1 } },
        });
        return split;
      }),
    );
  });
  app.post('/api/v1/references/:id/split/:splitId/publish', async (req, res) => {
    const b = z.strictObject({ expectedRevision: z.number().int().nonnegative() }).parse(req.body);
    send(
      res,
      await db.$transaction(async (tx) => {
        const sourceId = id.parse(req.params.id),
          source = await tx.referenceSource.findUniqueOrThrow({ where: { id: sourceId } }),
          split = await tx.referenceSplit.findUniqueOrThrow({
            where: { id: id.parse(req.params.splitId) },
          });
        requireThat(
          source.revision === b.expectedRevision &&
            split.sourceId === sourceId &&
            hash(split.payload) === split.hash &&
            !(await tx.libraryCommand.findUnique({ where: { scope: `reference:${sourceId}` } })),
          'REVISION_CONFLICT',
          '切分版本已变化或正在分析',
          409,
        );
        validateSplit(split.payload, [...source.text].length);
        await tx.referenceSplit.update({
          where: { id: split.id },
          data: { publishedAt: split.publishedAt || new Date() },
        });
        return tx.referenceSource.update({
          where: { id: sourceId },
          data: { activeSplitId: split.id, revision: { increment: 1 } },
          select: meta,
        });
      }),
    );
  });
  app.post('/api/v1/references/:id/analyze', async (req, res) => {
    const b = z
      .strictObject({ splitVersionId: id, expectedRevision: z.number().int().nonnegative() })
      .parse(req.body);
    send(
      res,
      await startLibrary(
        db,
        engine.modelReady(),
        {
          operation: 'ANALYZE',
          sourceId: id.parse(req.params.id),
          splitId: b.splitVersionId,
          expectedRevision: b.expectedRevision,
        },
        id.parse(req.get('idempotency-key')),
      ),
      202,
    );
  });
  app.post('/api/v1/references/:id/publish', async (req, res) => {
    const b = z
      .strictObject({ analysisVersionId: id, expectedRevision: z.number().int().nonnegative() })
      .parse(req.body);
    send(
      res,
      await db.$transaction(async (tx) => {
        const sourceId = id.parse(req.params.id),
          s = await tx.referenceSource.findUniqueOrThrow({ where: { id: sourceId } }),
          a = await tx.referenceAnalysis.findUniqueOrThrow({ where: { id: b.analysisVersionId } });
        requireThat(
          s.revision === b.expectedRevision &&
            a.sourceId === s.id &&
            a.splitId === s.activeSplitId &&
            !(await tx.libraryCommand.findUnique({ where: { scope: `reference:${s.id}` } })),
          'REVISION_CONFLICT',
          '参考版本已变化或正在分析',
          409,
        );
        requireThat(
          a.status === 'COMPLETE' && a.completedChars === a.totalChars,
          'REFERENCE_INCOMPLETE',
          '完整分析并解决实体疑义后才能发布',
        );
        await tx.referenceAnalysis.update({
          where: { id: a.id },
          data: { publishedAt: a.publishedAt || new Date() },
        });
        return tx.referenceSource.update({
          where: { id: s.id },
          data: { activeModelId: a.id, revision: { increment: 1 } },
          select: meta,
        });
      }),
    );
  });
}
