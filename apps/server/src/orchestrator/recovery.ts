import type { Job } from '@prisma/client';
import { jobRecoverySchema, recoveryRecordSchema } from '@one2novel/contracts';
import { AppError, hash, requireThat } from '../platform/core.js';
import type { DB, Tx } from '../platform/db.js';
import { resolveKnowledge } from '../knowledge/library.js';
import { resolveAuthorizedQuotes } from '../planning/quotes.js';
import { batchPosition } from './batch.js';

export const resumable = (j: Job) =>
  ['FAILED', 'PAUSED', 'INTERRUPTED', 'WAITING_USER'].includes(j.status);
export function requireResumeBudget(j: Job) {
  requireThat(j.httpUsed < j.httpLimit, 'BUDGET_EXHAUSTED', '请先增加当前章节调用额度');
  if (j.status === 'WAITING_USER' || j.errorCode === 'BODY_REPAIR_EXHAUSTED')
    requireThat(
      j.bodyRepairs < j.bodyRepairLimit,
      'BODY_REPAIR_EXHAUSTED',
      '请先增加正文修复额度，或修改草稿后新建任务',
    );
  if (j.errorCode === 'DELTA_REPAIR_EXHAUSTED')
    requireThat(
      j.deltaRepairs < j.deltaRepairLimit,
      'DELTA_REPAIR_EXHAUSTED',
      '请先增加状态修复额度',
    );
}
export async function requireResumeInputs(tx: Tx, j: Job) {
  requireThat(j.projectId, 'INVALID_JOB', '任务不属于小说');
  const p = await tx.project.findUniqueOrThrow({ where: { id: j.projectId } });
  const input = j.input as {
    planRevision?: number;
    openingId?: string | null;
    knowledge?: { hash: string };
    authorizedQuotes?: { hash: string };
    mode?: string;
    draftRevision?: number;
  };
  requireThat(
    input.planRevision === undefined ? p.planRevision === 0 : input.planRevision === p.planRevision,
    'STALE_INPUT',
    '计划版本已改变，请用当前输入新建任务',
    409,
  );
  requireThat(
    !('openingId' in input) || input.openingId === p.openingId,
    'STALE_INPUT',
    '全书方案已改变，请用当前输入新建任务',
    409,
  );
  requireThat(
    !input.knowledge || input.knowledge.hash === (await resolveKnowledge(tx, p.id)).hash,
    'STALE_INPUT',
    '知识绑定已改变，请用当前输入新建任务',
    409,
  );
  requireThat(
    !input.authorizedQuotes ||
      input.authorizedQuotes.hash === (await resolveAuthorizedQuotes(tx, p.id)).hash,
    'STALE_INPUT',
    '引用授权已改变，请用当前输入新建任务',
    409,
  );
  if (j.kind === 'BATCH') {
    const position = await batchPosition(tx, j);
    return { p, leaf: position.pending || j };
  }
  requireThat(
    j.chainEpoch === p.chainEpoch && j.baseSnapshotId === p.headSnapshotId,
    'STALE_INPUT',
    '故事基础已变化，请用当前输入新建任务',
    409,
  );
  if (input.mode === 'AUDIT_DRAFT') {
    const chapter = await tx.chapter.findUnique({
      where: { projectId_number: { projectId: p.id, number: j.number! } },
    });
    requireThat(
      chapter?.draftRevision === input.draftRevision,
      'STALE_INPUT',
      '草稿已修改，请新建审核任务；原候选不会被替换',
      409,
    );
  }
  return { p, leaf: j };
}
export async function jobRecovery(db: DB, jobId: string) {
  return db.$transaction(async (tx) => {
    const j = await tx.job.findUnique({ where: { id: jobId } });
    requireThat(j?.projectId && !j.parentId, 'NOT_FOUND', '找不到可处理的小说任务', 404);
    const leaf =
      j.kind === 'BATCH'
        ? (await tx.job.findFirst({
            where: { parentId: j.id, status: { not: 'SUCCEEDED' } },
            orderBy: { number: 'asc' },
          })) || j
        : j;
    const a = await tx.artifact.findFirst({
      where: { jobId: leaf.id, kind: 'RECOVERY' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    requireThat(!a || hash(a.payload) === a.hash, 'ARTIFACT_CORRUPTED', '解困记录校验失败');
    const p = await tx.project.findUniqueOrThrow({ where: { id: j.projectId } });
    const busy = !!(await tx.activeCommand.findUnique({ where: { projectId: p.id } }));
    let reason: string | null = null,
      needsBudget = false;
    try {
      requireThat(resumable(j) && !busy, 'INVALID_JOB_STATE', '任务正在执行或已经结束');
      const current = await requireResumeInputs(tx, j);
      if (current.leaf.kind !== 'BATCH') requireResumeBudget(current.leaf);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      reason = e.message;
      needsBudget = [
        'BUDGET_EXHAUSTED',
        'BODY_REPAIR_EXHAUSTED',
        'DELTA_REPAIR_EXHAUSTED',
      ].includes(e.code);
    }
    return jobRecoverySchema.parse({
      jobId,
      leafId: leaf.id,
      number: leaf.number,
      record: a ? recoveryRecordSchema.parse(a.payload) : null,
      canResume: reason === null,
      needsBudget,
      reason,
      canRestart:
        resumable(j) &&
        !busy &&
        !!p.headSnapshotId &&
        p.headChapter < p.targetCount &&
        ['CHAPTER', 'BATCH'].includes(j.kind),
    });
  });
}
