import { loadSnapshot, pack } from './story-state/snapshot.js';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  openingSchema,
  projectInputSchema,
  writeRequestSchema,
  id,
  text,
} from '@one2novel/contracts';
import { artifact, getArtifact, workspaceRoot, type DB } from './platform/db.js';
import { asJson, AppError, hash, normalize, requireThat, uuid } from './platform/core.js';
import { getConfig, saveConfig } from './orchestrator/config.js';
import { Orchestrator } from './orchestrator/service.js';
import { evaluators } from './evaluation/service.js';
import { skillDefinitions } from './knowledge/service.js';
import { validateOpening } from './story-state/service.js';
import type { ModelGateway } from './platform/llm.js';
export function createApp(db: DB, engine: Orchestrator, gateway: ModelGateway) {
  const app = express(),
    sessions = new Map<string, number>(),
    localToken = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));
  app.use((req, res, next) => {
    res.locals.requestId = uuid();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    const host = req.hostname;
    if (!['127.0.0.1', 'localhost'].includes(host))
      return next(new AppError('INVALID_HOST', '仅允许本机访问', 403));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin'),
        allowed = [
          'http://127.0.0.1:7456',
          'http://localhost:7456',
          'http://127.0.0.1:7457',
          'http://localhost:7457',
          `http://127.0.0.1:${process.env.PORT || 7456}`,
        ];
      if (origin ? !allowed.includes(origin) : req.get('x-local-token') !== localToken)
        return next(new AppError('INVALID_ORIGIN', '请从本机应用页面操作', 403));
    }
    next();
  });
  const send = (res: express.Response, data: unknown, status = 200) =>
    res.status(status).json({ data, requestId: res.locals.requestId });
  const key = (req: express.Request) => id.parse(req.get('idempotency-key'));
  const revision = z.number().int().nonnegative();
  app.get('/api/v1/health', (_req, res) => send(res, { ready: true, schemaVersion: 2 }));
  app.get('/api/v1/session', (_req, res) => send(res, { token: localToken }));
  app.get('/api/v1/projects', async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const items = await db.project.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}),
    });
    send(res, {
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? items[limit - 1].id : null,
    });
  });
  app.post('/api/v1/projects', async (req, res) => {
    const input = projectInputSchema.parse(req.body);
    send(
      res,
      await db.project.create({
        data: { id: uuid(), ...input, requirements: asJson(input.requirements) },
      }),
      201,
    );
  });
  app.get('/api/v1/projects/:id', async (req, res) => {
    const p = await db.project.findUnique({ where: { id: id.parse(req.params.id) } });
    requireThat(p, 'NOT_FOUND', '小说不存在', 404);
    const [chapters, jobs, artifacts] = await Promise.all([
      db.chapter.findMany({ where: { projectId: p.id }, orderBy: { number: 'asc' } }),
      db.job.findMany({
        where: { projectId: p.id, parentId: null },
        include: { children: { orderBy: { number: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      db.artifact.findMany({
        where: {
          projectId: p.id,
          kind: {
            in: ['OPENING', 'PLAN', 'ROLLING', 'EVALUATION', 'STATE_VALIDATION', 'PLAN_REVIEW'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);
    send(res, { ...p, chapters, jobs, artifacts });
  });
  app.post('/api/v1/projects/:id/opening-plans', async (req, res) => {
    const body = z.strictObject({ expectedRevision: revision }).parse(req.body);
    send(
      res,
      await engine.startJob(id.parse(req.params.id), 'OPENING', body.expectedRevision, key(req)),
      202,
    );
  });
  app.post('/api/v1/projects/:id/opening-candidates', async (req, res) => {
    const b = z
        .strictObject({ expectedRevision: revision, payload: openingSchema })
        .parse(req.body),
      projectId = id.parse(req.params.id);
    validateOpening(b.payload, projectId);
    const result = await db.$transaction(async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      requireThat(
        !p.headSnapshotId && p.revision === b.expectedRevision,
        'REVISION_CONFLICT',
        '开书状态已改变',
        409,
      );
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '请等待当前任务结束',
        409,
      );
      const a = await artifact(tx, projectId, 'OPENING', b.payload);
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return a;
    });
    send(res, result, 201);
  });
  app.post('/api/v1/projects/:id/opening-confirmations', async (req, res) => {
    const b = z
      .strictObject({
        openingId: id,
        expectedRevision: revision,
        acknowledgedWarnings: z.array(text),
      })
      .parse(req.body);
    send(
      res,
      await engine.confirmOpening(
        id.parse(req.params.id),
        b.openingId,
        b.expectedRevision,
        b.acknowledgedWarnings,
      ),
    );
  });
  app.post(
    ['/api/v1/projects/:id/write', '/api/v1/projects/:id/production-runs'],
    async (req, res) => {
      const b = writeRequestSchema.parse(req.body);
      send(
        res,
        await engine.startJob(
          id.parse(req.params.id),
          b.count > 1 ? 'BATCH' : 'CHAPTER',
          b.expectedRevision,
          key(req),
          {
            mode: b.mode,
            draftRevision: b.draftRevision,
            count: b.count,
          },
        ),
        202,
      );
    },
  );
  app.get('/api/v1/projects/:id/chapters/:number', async (req, res) => {
    const c = await db.chapter.findUnique({
      where: {
        projectId_number: {
          projectId: id.parse(req.params.id),
          number: z.coerce.number().int().positive().parse(req.params.number),
        },
      },
    });
    requireThat(c, 'NOT_FOUND', '章节不存在', 404);
    const versions = await db.content.findMany({
      where: { chapterId: c.id },
      orderBy: { createdAt: 'desc' },
    });
    send(res, { ...c, versions });
  });
  app.put('/api/v1/projects/:id/chapters/:number/draft', async (req, res) => {
    const b = z
        .strictObject({ text: text.max(100000), expectedRevision: revision })
        .parse(req.body),
      projectId = id.parse(req.params.id),
      number = z.coerce.number().int().positive().parse(req.params.number);
    const result = await db.$transaction(async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      requireThat(number <= p.headChapter + 1, 'INVALID_CHAPTER', '只能编辑已有章节或下一章');
      let c = await tx.chapter.findUnique({ where: { projectId_number: { projectId, number } } });
      if (!c) {
        requireThat(b.expectedRevision === 0, 'REVISION_CONFLICT', '草稿版本不匹配', 409);
        c = await tx.chapter.create({
          data: { id: uuid(), projectId, number, title: `第${number}章` },
        });
      }
      requireThat(
        c.draftRevision === b.expectedRevision,
        'REVISION_CONFLICT',
        '草稿已被其他页面修改，本地文本已保留',
        409,
      );
      return tx.chapter.update({
        where: { id: c.id },
        data: { draft: normalize(b.text), draftRevision: { increment: 1 } },
      });
    });
    send(res, result);
  });
  app.get('/api/v1/projects/:id/story-state', async (req, res) => {
    const p = await db.project.findUniqueOrThrow({ where: { id: id.parse(req.params.id) } });
    requireThat(p.headSnapshotId, 'NOT_READY', '尚未确认初始事实');
    const s = await loadSnapshot(
      db,
      req.query.snapshotId ? id.parse(req.query.snapshotId) : p.headSnapshotId,
      p.id,
    );
    send(res, s);
  });
  app.get('/api/v1/projects/:id/rewrite-preview', async (req, res) => {
    const p = await db.project.findUniqueOrThrow({ where: { id: id.parse(req.params.id) } }),
      n = z.coerce.number().int().positive().parse(req.query.fromChapter);
    requireThat(n <= p.headChapter, 'INVALID_CHAPTER', '没有可重写的已提交章节');
    const chapters = await db.chapter.findMany({
      where: { projectId: p.id, number: { gte: n }, activeContentId: { not: null } },
      orderBy: { number: 'asc' },
    });
    send(res, {
      expectedRevision: p.revision,
      expectedHeadSnapshotId: p.headSnapshotId,
      fromChapter: n,
      affectedContentIds: chapters.map((c) => c.activeContentId),
    });
  });
  app.post('/api/v1/projects/:id/rewrites', async (req, res) => {
    const b = z
        .strictObject({
          fromChapter: z.number().int().positive(),
          expectedRevision: revision,
          expectedHeadSnapshotId: id,
          affectedContentIds: z.array(id),
        })
        .parse(req.body),
      projectId = id.parse(req.params.id),
      requestKey = key(req),
      scope = `${projectId}:rewrite`,
      requestHash = hash(b);
    const result = await db.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({
        where: { scope_key: { scope, key: requestKey } },
      });
      if (receipt) {
        requireThat(
          receipt.requestHash === requestHash,
          'IDEMPOTENCY_CONFLICT',
          '请求键输入不同',
          409,
        );
        return receipt.response;
      }
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      requireThat(
        p.revision === b.expectedRevision &&
          p.headSnapshotId === b.expectedHeadSnapshotId &&
          b.fromChapter <= p.headChapter,
        'REVISION_CONFLICT',
        '重写预览已过期',
        409,
      );
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '存在活动任务',
        409,
      );
      const chapters = await tx.chapter.findMany({
        where: { projectId, number: { gte: b.fromChapter }, activeContentId: { not: null } },
        orderBy: { number: 'asc' },
      });
      requireThat(
        hash(chapters.map((c) => c.activeContentId)) === hash(b.affectedContentIds),
        'REVISION_CONFLICT',
        '受影响章节已改变',
        409,
      );
      let base = await tx.snapshot.findUniqueOrThrow({ where: { id: p.headSnapshotId! } });
      while (base.chapterNo >= b.fromChapter)
        base = await tx.snapshot.findUniqueOrThrow({ where: { id: base.parentId! } });
      await artifact(tx, projectId, 'REWRITE', { ...b, oldHead: p.headSnapshotId });
      await tx.chapter.updateMany({
        where: { projectId, number: { gte: b.fromChapter } },
        data: { activeContentId: null, status: 'STALE', revision: { increment: 1 } },
      });
      const result = await tx.project.update({
        where: { id: projectId },
        data: {
          headSnapshotId: base.id,
          headChapter: base.chapterNo,
          chainEpoch: { increment: 1 },
          revision: { increment: 1 },
          status: 'WRITING',
        },
      });
      await tx.receipt.create({
        data: { id: uuid(), scope, key: requestKey, requestHash, response: asJson(result) },
      });
      return result;
    });
    send(res, result);
  });
  app.get('/api/v1/projects/:id/export', async (req, res) => {
    const projectId = id.parse(req.params.id),
      format = req.query.format === 'md' ? 'md' : 'txt';
    const result = await db.$transaction(async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } }),
        chapters = await tx.chapter.findMany({
          where: { projectId, activeContentId: { not: null }, status: 'COMPLETED' },
          orderBy: { number: 'asc' },
        });
      const out = [format === 'md' ? `# ${p.title.replace(/[\n\r#]/g, ' ')}` : p.title];
      for (const c of chapters) {
        const v = await tx.content.findUniqueOrThrow({ where: { id: c.activeContentId! } });
        out.push(`${format === 'md' ? '## ' : ''}${c.title.replace(/[\n\r#]/g, ' ')}\n\n${v.text}`);
      }
      return { title: p.title, text: out.join('\n\n') + '\n' };
    });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.title.replace(/[<>:"/\\|?*]/g, '_'))}.${format}`,
    );
    res.type('text/plain; charset=utf-8').send(result.text);
  });
  app.get('/api/v1/jobs/:id', async (req, res) => {
    const j = await db.job.findUnique({
      where: { id: id.parse(req.params.id) },
      include: { children: { orderBy: { number: 'asc' } } },
    });
    requireThat(j, 'NOT_FOUND', '任务不存在', 404);
    send(res, j);
  });
  app.post('/api/v1/jobs/:id/retry', async (req, res) => {
    send(
      res,
      await engine.retry(
        id.parse(req.params.id),
        z.strictObject({ expectedRevision: revision }).parse(req.body).expectedRevision,
      ),
      202,
    );
  });
  app.post('/api/v1/jobs/:id/cancel', async (req, res) =>
    send(res, await engine.cancel(id.parse(req.params.id))),
  );
  app.post('/api/v1/jobs/:id/pause', async (req, res) =>
    send(
      res,
      await engine.pause(
        id.parse(req.params.id),
        z.strictObject({ expectedRevision: revision }).parse(req.body).expectedRevision,
      ),
    ),
  );
  app.post('/api/v1/jobs/:id/budget', async (req, res) => {
    const b = z
      .strictObject({
        expectedRevision: revision,
        httpLimit: z.number().int().min(1).max(1000),
        bodyRepairLimit: z.number().int().min(0).max(20),
        deltaRepairLimit: z.number().int().min(0).max(20),
      })
      .parse(req.body);
    const j = await db.$transaction(async (tx) => {
      const j = await tx.job.findUniqueOrThrow({ where: { id: id.parse(req.params.id) } });
      requireThat(j.kind !== 'BATCH', 'BATCH_CHILD_BUDGET', '请调整批次中未完成章节的额度');
      if (j.parentId) {
        const parent = await tx.job.findUniqueOrThrow({ where: { id: j.parentId } });
        requireThat(
          ['PAUSED', 'INTERRUPTED', 'FAILED'].includes(parent.status),
          'INVALID_JOB_STATE',
          '请先停止所属批次',
          409,
        );
      }
      requireThat(
        j.revision === b.expectedRevision && ['FAILED', 'PAUSED', 'INTERRUPTED'].includes(j.status),
        'REVISION_CONFLICT',
        '请在任务停止时调整额度',
        409,
      );
      requireThat(
        b.httpLimit >= j.httpUsed &&
          b.bodyRepairLimit >= j.bodyRepairs &&
          b.deltaRepairLimit >= j.deltaRepairs,
        'INVALID_BUDGET',
        '额度不能低于已用量',
      );
      await tx.jobEvent.create({ data: { jobId: j.id, type: 'budget', payload: asJson(b) } });
      return tx.job.update({
        where: { id: j.id },
        data: {
          httpLimit: b.httpLimit,
          bodyRepairLimit: b.bodyRepairLimit,
          deltaRepairLimit: b.deltaRepairLimit,
          revision: { increment: 1 },
        },
      });
    });
    send(res, j);
  });
  app.get('/api/v1/jobs/:id/events', async (req, res) => {
    const jobId = id.parse(req.params.id);
    requireThat(await db.job.findUnique({ where: { id: jobId } }), 'NOT_FOUND', '任务不存在', 404);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let cursor = Number(req.get('last-event-id') || req.query.after || 0),
      closed = false,
      polling = false;
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const events = await db.jobEvent.findMany({
          where: { jobId, id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: 100,
        });
        for (const e of events) {
          res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
          cursor = e.id;
        }
        res.write(': heartbeat\n\n');
      } catch {
        res.end();
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), 1000);
    req.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
    await poll();
  });
  app.get('/api/v1/settings/models', async (_req, res) =>
    send(res, { ...(await getConfig(db, 'models')), credentialConfigured: gateway.ready() }),
  );
  app.put('/api/v1/settings/models', async (req, res) => {
    const b = z.strictObject({ payload: z.unknown(), expectedRevision: revision }).parse(req.body);
    send(res, await saveConfig(db, 'models', b.payload, b.expectedRevision));
  });
  let testing = false;
  app.post('/api/v1/settings/models/test', async (_req, res) => {
    requireThat(
      !testing && !(await db.job.count({ where: { status: { in: ['RUNNING', 'QUEUED'] } } })),
      'MODEL_BUSY',
      '请在生产任务结束后测试模型',
      409,
    );
    testing = true;
    try {
      const config = await getConfig(db, 'models');
      const answer = await gateway.call<string>({
        prompt: 'connection.test',
        input: { message: 'OK' },
        settings: config.payload as never,
        signal: AbortSignal.timeout(180000),
        reserve: async () => {},
      });
      send(res, { ok: true, answer });
    } finally {
      testing = false;
    }
  });
  app.post('/api/v1/admin/session', (req, res) => {
    const configured = process.env.ONE2NOVEL_ADMIN_TOKEN;
    requireThat(configured, 'ADMIN_DISABLED', '请在 .env 设置 ONE2NOVEL_ADMIN_TOKEN', 503);
    const token = z.strictObject({ token: text.max(500) }).parse(req.body).token;
    const a = Buffer.from(hash(token)),
      b = Buffer.from(hash(configured));
    requireThat(timingSafeEqual(a, b), 'ADMIN_UNAUTHORIZED', '管理员口令不正确', 401);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, Date.now() + 3600000);
    res.cookie('one2novel_admin', session, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 3600000,
      path: '/api/v1/admin',
    });
    send(res, { ok: true });
  });
  app.use('/api/v1/admin', (req, _res, next) => {
    const session = (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('one2novel_admin='))
      ?.split('=')[1];
    if (!session || (sessions.get(session) || 0) < Date.now())
      return next(new AppError('ADMIN_UNAUTHORIZED', '请登录独立管理后台', 401));
    next();
  });
  app.delete('/api/v1/admin/session', (req, res) => {
    const session = (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('one2novel_admin='))
      ?.split('=')[1];
    if (session) sessions.delete(session);
    res.clearCookie('one2novel_admin', { path: '/api/v1/admin' });
    send(res, { ok: true });
  });
  app.get('/api/v1/admin/definitions', (_req, res) =>
    send(res, { evaluators, skills: skillDefinitions }),
  );
  for (const kind of ['skills', 'policy']) {
    app.get(`/api/v1/admin/${kind}`, async (_req, res) => send(res, await getConfig(db, kind)));
    app.get(`/api/v1/admin/${kind}/versions`, async (_req, res) =>
      send(
        res,
        await db.configVersion.findMany({ where: { kind }, orderBy: { createdAt: 'desc' } }),
      ),
    );
    app.post(`/api/v1/admin/${kind}/versions`, async (req, res) => {
      const b = z
        .strictObject({ payload: z.unknown(), expectedRevision: revision })
        .parse(req.body);
      send(res, await saveConfig(db, kind, b.payload, b.expectedRevision), 201);
    });
  }
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在', 404)));
  const web = resolve(workspaceRoot, 'apps/web/dist');
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(web, 'index.html')));
  }
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) return;
      const e =
        error instanceof AppError
          ? error
          : error instanceof z.ZodError
            ? new AppError(
                'VALIDATION_ERROR',
                '输入格式不正确',
                422,
                error.issues.map((i) => ({ path: i.path, message: i.message })),
              )
            : new AppError('INTERNAL_ERROR', '操作未完成，请刷新后重试', 500);
      res.status(e.status).json({
        error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
        requestId: res.locals.requestId,
      });
    },
  );
  return app;
}
