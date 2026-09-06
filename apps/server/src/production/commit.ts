import type { Job } from '@prisma/client';
import { stateValidationSchema, type EvaluatorResult, type Extraction } from '@one2novel/contracts';
import type { DB } from '../platform/db.js';
import { pack } from '../story-state/snapshot.js';
import { validatePolicy, gate } from '../evaluation/service.js';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';
type CommitConfig = { policy: { payload: unknown; versionId: string } };
export async function commitChapter(
  db: DB,
  j: Job,
  chapterId: string,
  contentId: string,
  evaluation: {
    status: string;
    results: EvaluatorResult[];
    contentId: string;
    policyVersionId: string;
  },
  evaluationId: string,
  x: Extraction,
  state: Parameters<typeof pack>[0],
  validationId: string,
) {
  requireThat(j.projectId, 'INVALID_JOB', '正式提交需要小说归属');
  const projectId = j.projectId;
  const frozen = j.config as unknown as CommitConfig,
    policy = validatePolicy(frozen.policy.payload),
    snapshotId = uuid(),
    deltaId = uuid(),
    checkpoint = state.chapterNo % 20 === 0 ? pack(state) : null;
  return db.$transaction(async (tx) => {
    const receipt = await tx.commitReceipt.findUnique({ where: { jobId: j.id } });
    if (receipt) return receipt;
    const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } }),
      p = await tx.project.findUniqueOrThrow({ where: { id: projectId } }),
      owner = await tx.activeCommand.findUnique({ where: { projectId: p.id } });
    const parent = latest.parentId
      ? await tx.job.findUniqueOrThrow({ where: { id: latest.parentId } })
      : null;
    requireThat(
      owner?.jobId === (latest.parentId || j.id) &&
        (!parent ||
          (parent.kind === 'BATCH' &&
            parent.projectId === p.id &&
            parent.status === 'RUNNING' &&
            !parent.cancelRequested)) &&
        latest.status === 'RUNNING' &&
        !latest.cancelRequested &&
        p.chainEpoch === j.chainEpoch &&
        p.headSnapshotId === j.baseSnapshotId &&
        p.headChapter + 1 === j.number,
      'COMMIT_CONFLICT',
      '提交基础或任务身份已变化',
      409,
    );
    requireThat(
      evaluation.status === 'PASS' &&
        gate(evaluation.results, policy) === 'PASS' &&
        evaluation.contentId === contentId &&
        evaluation.policyVersionId === frozen.policy.versionId &&
        x.delta.contentVersionId === contentId,
      'EVALUATION_REQUIRED',
      '未通过当前正文的冻结策略审核',
    );
    const validation = await tx.artifact.findUniqueOrThrow({ where: { id: validationId } });
    requireThat(
      validation.jobId === j.id && validation.kind === 'STATE_VALIDATION',
      'STATE_VALIDATION_REQUIRED',
      '缺少状态验证',
    );
    const checked = stateValidationSchema.parse(validation.payload);
    requireThat(
      hash(validation.payload) === validation.hash &&
        !checked.missingChanges.length &&
        checked.checks.length === x.delta.changes.length &&
        new Set(checked.checks.map((c) => c.changeIndex)).size === x.delta.changes.length &&
        checked.checks.every(
          (c) => c.verdict === 'PASS' && c.changeIndex < x.delta.changes.length,
        ) &&
        (x.delta.changes.length > 0 || checked.noStateChange),
      'STATE_VALIDATION_REQUIRED',
      '持久化的状态验证未完整通过',
    );
    const storedEvaluation = await tx.artifact.findUniqueOrThrow({ where: { id: evaluationId } }),
      storedContent = await tx.content.findUniqueOrThrow({ where: { id: contentId } }),
      storedChapter = await tx.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    requireThat(
      storedEvaluation.jobId === j.id &&
        storedEvaluation.kind === 'EVALUATION' &&
        hash(storedEvaluation.payload) === storedEvaluation.hash &&
        hash(evaluation) === storedEvaluation.hash &&
        storedContent.chapterId === chapterId &&
        storedChapter.projectId === p.id &&
        storedChapter.number === j.number &&
        hash(storedContent.text) === storedContent.hash,
      'COMMIT_CONFLICT',
      '审核、正文与章节归属不一致',
    );
    requireThat(
      state.projectId === p.id &&
        state.chapterNo === j.number &&
        x.delta.baseSnapshotId === j.baseSnapshotId,
      'COMMIT_CONFLICT',
      '状态或Delta版本不一致',
    );
    await tx.delta.create({
      data: {
        id: deltaId,
        projectId: p.id,
        baseSnapshotId: p.headSnapshotId!,
        contentId,
        payload: asJson(x.delta),
        hash: hash(x.delta),
      },
    });
    await tx.snapshot.create({
      data: {
        id: snapshotId,
        projectId: p.id,
        chapterNo: j.number!,
        parentId: p.headSnapshotId,
        canonId: state.canonVersionId,
        deltaId,
        validationId,
        contentId,
        stateHash: hash(state),
        checkpoint,
      },
    });
    for (const e of x.events)
      await tx.storyEvent.create({
        data: {
          id: e.id,
          projectId: p.id,
          contentId,
          snapshotId,
          eventOrder: e.order,
          payload: asJson(e),
        },
      });
    for (const v of x.delta.propositionVersions)
      await tx.propositionVersion.create({
        data: {
          id: v.id,
          projectId: p.id,
          propositionId: v.propositionId,
          snapshotId,
          payload: asJson(v),
        },
      });
    await tx.chapter.update({
      where: { id: chapterId },
      data: { activeContentId: contentId, status: 'COMPLETED', revision: { increment: 1 } },
    });
    await tx.project.update({
      where: { id: p.id },
      data: {
        headChapter: j.number!,
        headSnapshotId: snapshotId,
        status: 'WRITING',
        revision: { increment: 1 },
      },
    });
    await tx.planningRecheck.create({ data: { snapshotId, projectId: p.id } });
    const completed = await tx.commitReceipt.create({
      data: { jobId: j.id, snapshotId, contentId },
    });
    await tx.job.update({
      where: { id: j.id },
      data: { status: 'SUCCEEDED', stage: 'SUCCEEDED', revision: { increment: 1 } },
    });
    if (parent) {
      const range = parent.input as { fromChapter: number; endChapter: number; count: number };
      requireThat(
        j.number! >= range.fromChapter && j.number! <= range.endChapter,
        'COMMIT_CONFLICT',
        '章节不属于批次范围',
      );
      const status =
        j.number === range.endChapter ? 'SUCCEEDED' : parent.pauseRequested ? 'PAUSED' : 'QUEUED';
      await tx.job.update({
        where: { id: parent.id },
        data: {
          status,
          stage: status === 'QUEUED' ? 'NEXT' : status,
          revision: { increment: 1 },
        },
      });
      await tx.jobEvent.create({
        data: {
          jobId: parent.id,
          type: status === 'QUEUED' ? 'progress' : 'done',
          payload: {
            status,
            childId: j.id,
            number: j.number,
            completed: j.number! - range.fromChapter + 1,
            count: range.count,
          },
        },
      });
      if (status !== 'QUEUED') await tx.activeCommand.delete({ where: { projectId: p.id } });
    } else await tx.activeCommand.delete({ where: { projectId: p.id } });
    await tx.jobEvent.create({
      data: { jobId: j.id, type: 'committed', payload: { snapshotId, contentId, evaluationId } },
    });
    return completed;
  });
}
