import { z } from 'zod';
import type { Job } from '@prisma/client';
import type { DB, Tx } from '../platform/db.js';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';

export const batchInputSchema = z.strictObject({
  planRevision: z.number().int().nonnegative().optional(),
  openingId: z.string().uuid().nullable().optional(),
  knowledge: z.json().optional(),
  authorizedQuotes: z.json().optional(),
  mode: z.literal('GENERATE'),
  count: z.number().int().min(2).max(10),
  fromChapter: z.number().int().positive(),
  endChapter: z.number().int().positive(),
});

// A batch owns the project lock throughout every child and every scheduling gap.
// Its frozen input never moves; successful child receipts describe its current base.
export async function batchPosition(tx: Tx, parent: Job) {
  requireThat(parent.projectId, 'INVALID_BATCH', '批次需要小说归属');
  const input = batchInputSchema.parse(parent.input);
  requireThat(
    input.endChapter === input.fromChapter + input.count - 1,
    'INVALID_BATCH',
    '批次范围不一致',
  );
  const p = await tx.project.findUniqueOrThrow({ where: { id: parent.projectId } });
  const children = await tx.job.findMany({
    where: { parentId: parent.id },
    orderBy: { number: 'asc' },
  });
  let next = input.fromChapter,
    base = parent.baseSnapshotId;
  let pending: Job | undefined;
  for (const child of children) {
    requireThat(
      !pending &&
        child.number === next &&
        child.projectId === p.id &&
        child.chainEpoch === parent.chainEpoch &&
        child.baseSnapshotId === base,
      'STALE_INPUT',
      '批次章节依赖不连续',
      409,
    );
    if (child.status !== 'SUCCEEDED') {
      pending = child;
      continue;
    }
    const receipt = await tx.commitReceipt.findUnique({ where: { jobId: child.id } });
    requireThat(receipt, 'STALE_INPUT', '批次章节缺少正式提交凭据', 409);
    base = receipt.snapshotId;
    next++;
  }
  requireThat(
    (input.planRevision === undefined
      ? p.planRevision === 0
      : input.planRevision === p.planRevision) &&
      p.chainEpoch === parent.chainEpoch &&
      p.headSnapshotId === base &&
      p.headChapter === next - 1 &&
      p.targetCount >= input.endChapter,
    'STALE_INPUT',
    '故事基础已变化，请用当前进度新建批次',
    409,
  );
  return { input, p, next, base, pending };
}

export async function scheduleBatch(db: DB, parentId: string) {
  return db.$transaction(async (tx) => {
    const parent = await tx.job.findUniqueOrThrow({ where: { id: parentId } });
    requireThat(parent.projectId, 'INVALID_BATCH', '批次需要小说归属');
    if (['PAUSED', 'CANCELLED'].includes(parent.status)) return;
    const owner = await tx.activeCommand.findUnique({ where: { projectId: parent.projectId } });
    requireThat(
      owner?.jobId === parent.id && !parent.cancelRequested && parent.status === 'RUNNING',
      'CANCELLED',
      '批次已停止',
      409,
    );
    const { input, p, next, base, pending } = await batchPosition(tx, parent);
    if (parent.pauseRequested || next > input.endChapter) {
      const status = next > input.endChapter ? 'SUCCEEDED' : 'PAUSED';
      await tx.job.update({
        where: { id: parent.id },
        data: { status, stage: status, revision: { increment: 1 } },
      });
      await tx.activeCommand.delete({ where: { projectId: p.id } });
      await tx.jobEvent.create({ data: { jobId: parent.id, type: 'done', payload: { status } } });
      return;
    }
    // A failed child is resumed by retryBatch, never replaced or skipped here.
    requireThat(!pending, 'BATCH_CHILD_PENDING', '请先恢复批次中未完成的章节', 409);
    const child = await tx.job.create({
      data: {
        id: uuid(),
        parentId: parent.id,
        projectId: p.id,
        kind: 'CHAPTER',
        number: next,
        chainEpoch: parent.chainEpoch,
        baseSnapshotId: base,
        input: asJson({
          ...(input.planRevision !== undefined ? { planRevision: input.planRevision } : {}),
          mode: 'GENERATE',
          ...('openingId' in (parent.input as object)
            ? { openingId: (parent.input as { openingId: string | null }).openingId }
            : {}),
          knowledge: (parent.input as { knowledge?: unknown }).knowledge || {
            items: [],
            hash: hash([]),
          },
          authorizedQuotes: (parent.input as { authorizedQuotes?: unknown }).authorizedQuotes || {
            items: [],
            hash: hash([]),
          },
        }),
        config: asJson(parent.config),
        artifactRefs: {},
      },
    });
    await tx.job.update({
      where: { id: parent.id },
      data: { stage: 'CHILD_RUNNING', revision: { increment: 1 } },
    });
    await tx.jobEvent.create({
      data: {
        jobId: parent.id,
        type: 'progress',
        payload: {
          childId: child.id,
          number: next,
          completed: next - input.fromChapter,
          count: input.count,
        },
      },
    });
  });
}

export async function retryBatch(tx: Tx, parent: Job) {
  requireThat(parent.projectId, 'INVALID_BATCH', '批次需要小说归属');
  const { pending } = await batchPosition(tx, parent);
  if (pending) {
    requireThat(
      ['FAILED', 'INTERRUPTED', 'PAUSED', 'WAITING_USER'].includes(pending.status),
      'INVALID_JOB_STATE',
      '当前子任务不可恢复',
      409,
    );
    requireThat(
      pending.httpUsed < pending.httpLimit,
      'BUDGET_EXHAUSTED',
      '请先增加当前章节调用额度',
    );
    await tx.job.update({
      where: { id: pending.id },
      data: {
        status: 'QUEUED',
        cancelRequested: false,
        errorCode: null,
        errorMessage: null,
        revision: { increment: 1 },
      },
    });
  }
  await tx.activeCommand.create({ data: { projectId: parent.projectId, jobId: parent.id } });
  const updated = await tx.job.update({
    where: { id: parent.id },
    data: {
      status: pending ? 'RUNNING' : 'QUEUED',
      stage: pending ? 'CHILD_RUNNING' : 'NEXT',
      pauseRequested: false,
      cancelRequested: false,
      errorCode: null,
      errorMessage: null,
      revision: { increment: 1 },
    },
  });
  await tx.jobEvent.create({
    data: { jobId: parent.id, type: 'stage', payload: { stage: updated.stage, action: 'RESUME' } },
  });
  return updated;
}

export async function pauseBatch(db: DB, jobId: string, revision: number) {
  return db.$transaction(async (tx) => {
    const j = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    requireThat(
      j.kind === 'BATCH' && revision <= j.revision,
      'REVISION_CONFLICT',
      '批次已变化，请刷新',
      409,
    );
    requireThat(
      ['RUNNING', 'QUEUED'].includes(j.status) && !j.cancelRequested,
      'INVALID_JOB_STATE',
      '批次当前不能暂停',
      409,
    );
    const child = await tx.job.findFirst({
      where: { parentId: j.id, status: { in: ['QUEUED', 'RUNNING'] } },
    });
    // Once a chapter has been scheduled it finishes the full atomic pipeline before pause.
    const updated = await tx.job.update({
      where: { id: j.id },
      data: {
        pauseRequested: true,
        ...(!child ? { status: 'PAUSED', stage: 'PAUSED' } : {}),
        revision: { increment: 1 },
      },
    });
    if (!child) await tx.activeCommand.deleteMany({ where: { jobId } });
    await tx.jobEvent.create({
      data: { jobId, type: 'progress', payload: { pauseRequested: true, status: updated.status } },
    });
    return updated;
  });
}
