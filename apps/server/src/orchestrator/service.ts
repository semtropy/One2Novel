import { checkStateValidation, validationInput } from '../story-state/validation.js';
import { requireResumeInputs, requireResumeBudget, resumable } from './recovery.js';
import { commitChapter } from '../production/commit.js';
import { runLibrary } from './library.js';
import {
  referenceTextSources,
  resolveKnowledge,
  validateOpeningKnowledge,
  type KnowledgeContext,
} from '../knowledge/library.js';
import { scheduleBatch, retryBatch, pauseBatch } from './batch.js';
import { loadSnapshot, pack } from '../story-state/snapshot.js';
import { forkInitialOpening } from '../story-state/opening.js';
import {
  ensureBookPlan,
  activePlanLayers,
  registerRolling,
  activatePlanVersions,
  readPlan,
} from '../planning/versions.js';
import { z } from 'zod';
import {
  openingSchema,
  rollingSchema,
  volumeSchema,
  arcSchema,
  planningValidationSchema,
  evaluationResponseSchema,
  extractionSchema,
  stateValidationSchema,
  type Opening,
  type ChapterPlan,
  type Settings,
  type Policy,
  type EvaluatorResult,
  type Extraction,
} from '@one2novel/contracts';
import type { Job } from '@prisma/client';
import { artifact, getArtifact, type DB } from '../platform/db.js';
import {
  AppError,
  asJson,
  hash,
  normalize,
  requireThat,
  uuid,
  identifiers,
  remapProposal,
} from '../platform/core.js';
import { freezeConfig, type FrozenConfig } from './config.js';
import type { ModelGateway } from '../platform/llm.js';
import { promptVersion, type PromptId } from '../platform/prompts.js';
import { assumptionChecks, simulate, validateOpening } from '../story-state/service.js';
import {
  deterministicStateConstraintIssues,
  effectiveHardConstraints,
  validateBook,
  validateConstraints,
} from '../planning/service.js';
import { resolveAuthorizedQuotes } from '../planning/quotes.js';
import {
  deterministicIssues,
  evaluators,
  gate,
  validatePolicy,
  validateResults,
} from '../evaluation/service.js';
import { resolveStateContext } from '../production/context.js';
import { skillDefinitions, defaultSkills } from '../knowledge/service.js';
type Refs = Record<string, string>;
export class Orchestrator {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private controllers = new Map<string, AbortController>();
  private stopped = false;
  constructor(
    public db: DB,
    private gateway: ModelGateway,
  ) {}
  async recover() {
    await this.db.$transaction(async (tx) => {
      await tx.job.updateMany({
        where: { status: { in: ['RUNNING', 'QUEUED'] } },
        data: {
          status: 'INTERRUPTED',
          errorCode: 'PROCESS_INTERRUPTED',
          errorMessage: '服务曾中断，请手动恢复。',
          revision: { increment: 1 },
        },
      });
      await tx.activeCommand.deleteMany();
      await tx.libraryCommand.deleteMany();
    });
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        /* persisted per-job failures; never log prompt or key */
      });
    }, 250);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const c of this.controllers.values()) c.abort();
    while (this.busy) await new Promise((r) => setTimeout(r, 30));
  }
  modelReady() {
    return this.gateway.ready();
  }
  async emit(jobId: string, type: string, payload: unknown) {
    return this.db.jobEvent.create({ data: { jobId, type, payload: asJson(payload) } });
  }
  async startJob(
    projectId: string,
    kind: 'OPENING' | 'CHAPTER' | 'BATCH' | 'PLAN_ACTIVATE',
    revision: number,
    key: string,
    input: Record<string, unknown> = {},
    restart?: { id: string; revision: number },
  ) {
    if (kind === 'BATCH') {
      requireThat(
        Number.isInteger(input.count) &&
          Number(input.count) >= 2 &&
          Number(input.count) <= 10 &&
          input.mode === 'GENERATE',
        'INVALID_BATCH',
        '连续生产只能生成2到10章',
      );
    }
    const config = await freezeConfig(this.db);
    requireThat(
      this.gateway.ready(),
      'MODEL_NOT_CONFIGURED',
      '请先配置 ChatAnyWhere 服务端密钥',
      503,
    );
    const settings = config.models.payload as Settings;
    requireThat(
      settings.profiles.length &&
        Object.values(settings.roleMappings).every((id) =>
          settings.profiles.some((p) => p.id === id),
        ),
      'MODEL_NOT_CONFIGURED',
      '请先完成模型设置',
      503,
    );
    const scope = `${projectId}:${kind}`,
      requestHash = hash(restart ? { revision, input, restart } : { revision, input });
    const job = await this.db.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { scope_key: { scope, key } } });
      if (receipt) {
        requireThat(
          receipt.requestHash === requestHash,
          'IDEMPOTENCY_CONFLICT',
          '同一请求键不能用于不同输入',
          409,
        );
        return tx.job.findUniqueOrThrow({ where: { id: (receipt.response as { id: string }).id } });
      }
      const p = await tx.project.findUnique({ where: { id: projectId } });
      requireThat(p, 'NOT_FOUND', '小说不存在', 404);
      requireThat(p.revision === revision, 'REVISION_CONFLICT', '小说已更新，请刷新', 409);
      if (restart) {
        const old = await tx.job.findUnique({ where: { id: restart.id } });
        requireThat(
          old &&
            old.projectId === projectId &&
            !old.parentId &&
            ['CHAPTER', 'BATCH'].includes(old.kind) &&
            old.revision === restart.revision &&
            resumable(old),
          'REVISION_CONFLICT',
          '原任务已变化，请刷新后重试',
          409,
        );
      }
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '这本小说已有任务正在执行',
        409,
      );
      if (kind === 'OPENING') requireThat(!p.headSnapshotId, 'OPENING_CONFIRMED', '开书方案已确认');
      else
        requireThat(
          p.headSnapshotId && p.openingId && p.headChapter < p.targetCount,
          'NOT_READY',
          '请先确认开书方案，或已到目标章数',
        );
      if (input.mode === 'AUDIT_DRAFT') {
        const c = await tx.chapter.findUnique({
          where: { projectId_number: { projectId, number: p.headChapter + 1 } },
        });
        requireThat(
          c && c.draftRevision === input.draftRevision && c.draft.trim(),
          'REVISION_CONFLICT',
          '草稿为空或版本已改变',
          409,
        );
        input = { ...input, text: normalize(c.draft) };
      }
      if (kind === 'BATCH') {
        requireThat(
          p.headChapter + Number(input.count) <= p.targetCount,
          'INVALID_BATCH',
          '批次不能超出剩余目标章节',
        );
        input = {
          mode: 'GENERATE',
          count: input.count,
          fromChapter: p.headChapter + 1,
          endChapter: p.headChapter + Number(input.count),
        };
      }
      input = {
        ...input,
        planRevision: p.planRevision,
        openingId: p.openingId,
        knowledge: await resolveKnowledge(tx, projectId),
        authorizedQuotes: await resolveAuthorizedQuotes(tx, projectId),
      };
      const job = await tx.job.create({
        data: {
          id: uuid(),
          projectId,
          kind,
          number: kind === 'CHAPTER' ? p.headChapter + 1 : null,
          chainEpoch: p.chainEpoch,
          baseSnapshotId: p.headSnapshotId,
          input: asJson(input),
          config: asJson(config),
          artifactRefs: {},
          httpLimit: kind === 'OPENING' ? 100 : 40,
        },
      });
      await tx.activeCommand.create({ data: { projectId, jobId: job.id } });
      if (restart) {
        // Retire the old command atomically with the new one; history and counters stay intact.
        await tx.job.update({
          where: { id: restart.id },
          data: { status: 'CANCELLED', cancelRequested: true, revision: { increment: 1 } },
        });
        await tx.job.updateMany({
          where: { parentId: restart.id, status: { not: 'SUCCEEDED' } },
          data: { status: 'CANCELLED', cancelRequested: true, revision: { increment: 1 } },
        });
        await tx.jobEvent.create({
          data: {
            jobId: restart.id,
            type: 'restarted',
            payload: { newJobId: job.id, mode: String(input.mode) },
          },
        });
        await tx.jobEvent.create({
          data: {
            jobId: job.id,
            type: 'created',
            payload: {
              sourceJobId: restart.id,
              mode: String(input.mode),
              baseSnapshotId: p.headSnapshotId,
              openingId: p.openingId,
            },
          },
        });
      }
      await tx.receipt.create({
        data: { id: uuid(), scope, key, requestHash, response: { id: job.id } },
      });
      return job;
    });
    return job;
  }
  async retry(jobId: string, revision: number) {
    return this.db.$transaction(async (tx) => {
      const j = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
      requireThat(!j.parentId, 'BATCH_CONTROL_REQUIRED', '请通过所属批次恢复当前章节', 409);
      requireThat(j.revision === revision, 'REVISION_CONFLICT', '任务已变化', 409);
      requireThat(
        ['FAILED', 'INTERRUPTED', 'PAUSED', 'WAITING_USER'].includes(j.status),
        'INVALID_JOB_STATE',
        '此任务不能恢复',
      );
      if (!j.projectId) {
        const input = j.input as { scope: string; itemId?: string; revision: number };
        requireThat(
          !(await tx.libraryCommand.findUnique({ where: { scope: input.scope } })),
          'PROJECT_BUSY',
          '该参考或知识已有活动任务',
          409,
        );
        if (input.itemId)
          requireThat(
            (await tx.knowledgeItem.findUniqueOrThrow({ where: { id: input.itemId } })).revision ===
              input.revision,
            'STALE_INPUT',
            '知识版本已修改，请创建新任务',
            409,
          );
        await tx.libraryCommand.create({ data: { scope: input.scope, jobId } });
        return tx.job.update({
          where: { id: jobId },
          data: {
            status: 'QUEUED',
            errorCode: null,
            errorMessage: null,
            revision: { increment: 1 },
          },
        });
      }
      const p = await tx.project.findUniqueOrThrow({ where: { id: j.projectId } });
      const recovery = await requireResumeInputs(tx, j);
      if (recovery.leaf.kind !== 'BATCH') requireResumeBudget(recovery.leaf);
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId: p.id } })),
        'PROJECT_BUSY',
        '小说已有活动任务',
        409,
      );
      if (j.kind === 'BATCH') return retryBatch(tx, j);
      requireThat(
        j.chainEpoch === p.chainEpoch && j.baseSnapshotId === p.headSnapshotId,
        'STALE_INPUT',
        '故事基础已变化，请重新启动任务',
        409,
      );
      await tx.activeCommand.create({ data: { projectId: p.id, jobId } });
      return tx.job.update({
        where: { id: jobId },
        data: {
          status: 'QUEUED',
          cancelRequested: false,
          errorCode: null,
          errorMessage: null,
          revision: { increment: 1 },
        },
      });
    });
  }
  async pause(jobId: string, revision: number) {
    return pauseBatch(this.db, jobId, revision);
  }
  async cancel(jobId: string) {
    const abortIds: string[] = [];
    const result = await this.db.$transaction(async (tx) => {
      const j = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
      requireThat(!j.parentId, 'BATCH_CONTROL_REQUIRED', '请通过所属批次取消任务', 409);
      if (['SUCCEEDED', 'CANCELLED'].includes(j.status)) return j;
      let running = j.status === 'RUNNING';
      if (j.kind === 'BATCH') {
        const children = await tx.job.findMany({
          where: { parentId: j.id, status: { notIn: ['SUCCEEDED', 'CANCELLED'] } },
        });
        running = children.some((c) => c.status === 'RUNNING');
        for (const c of children) {
          abortIds.push(c.id);
          await tx.job.update({
            where: { id: c.id },
            data: {
              cancelRequested: true,
              ...(c.status !== 'RUNNING' ? { status: 'CANCELLED' } : {}),
              revision: { increment: 1 },
            },
          });
        }
      }
      const v = await tx.job.update({
        where: { id: jobId },
        data: {
          cancelRequested: true,
          ...(!running ? { status: 'CANCELLED' } : {}),
          revision: { increment: 1 },
        },
      });
      if (!running) {
        await tx.activeCommand.deleteMany({ where: { jobId } });
        await tx.libraryCommand.deleteMany({ where: { jobId } });
      }
      await tx.jobEvent.create({
        data: { jobId, type: 'progress', payload: { cancelRequested: true, status: v.status } },
      });
      return v;
    });
    this.controllers.get(jobId)?.abort();
    for (const childId of abortIds) this.controllers.get(childId)?.abort();
    return result;
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const j = await this.db.job.findFirst({
        where: { status: 'QUEUED' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (j) await this.execute(j);
    } finally {
      this.busy = false;
    }
  }
  private async stage(jobId: string, stage: string) {
    await this.db.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id: jobId },
        data: { stage, revision: { increment: 1 } },
      });
      await tx.jobEvent.create({ data: { jobId, type: 'stage', payload: { stage } } });
      if (j.parentId)
        await tx.jobEvent.create({
          data: {
            jobId: j.parentId,
            type: 'progress',
            payload: { childId: j.id, number: j.number, stage },
          },
        });
    });
  }
  private async saveRef(jobId: string, key: string, id: string) {
    const j = await this.db.job.findUniqueOrThrow({ where: { id: jobId } });
    await this.db.job.update({
      where: { id: jobId },
      data: { artifactRefs: { ...(j.artifactRefs as Refs), [key]: id } },
    });
  }
  private async saveArtifact(j: Job, key: string, payload: unknown) {
    requireThat(j.projectId, 'INVALID_JOB', '产物需要小说归属');
    const a = await artifact(this.db, j.projectId, key, payload, j.baseSnapshotId, j.id);
    await this.saveRef(j.id, key, a.id);
    return a.id;
  }
  private stateFailureNeedsBodyRepair(failure: { code: string }) {
    return ['STATE_CONSTRAINT_FAILED', 'ILLEGAL_REVIVAL', 'IMMUTABLE_RULE'].includes(failure.code);
  }
  private stateFailureIssue(failure: { code: string; message: string }, contentId: string) {
    return {
      id: uuid(),
      evaluatorId: 'core.state-consistency',
      severity: 'BLOCKER',
      ruleId: failure.code,
      message: failure.message,
      spans: [],
      relatedRefs: [{ kind: 'CONTENT', id: contentId }],
      suggestion: '修正文中与既定事实或不可变规则冲突的情节，不要通过改写Canon或删除真实事件绕过。',
    };
  }
  private async call<T>(
    j: Job,
    prompt: PromptId,
    input: unknown,
    schema?: z.ZodType<T>,
    maxHttp?: number,
  ): Promise<T> {
    const config = j.config as unknown as FrozenConfig;
    requireThat(
      config.promptVersion === promptVersion && config.stateRuleVersion === '1',
      'CONFIG_VERSION_UNAVAILABLE',
      '任务引用旧实现版本，无法静默替换',
    );
    let localUsed = 0;
    return this.gateway.call({
      prompt,
      input,
      schema,
      settings: config.models.payload as Settings,
      signal: this.controllers.get(j.id)!.signal,
      reserve: async () => {
        await this.db.$transaction(async (tx) => {
          const current = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
          requireThat(!current.cancelRequested, 'CANCELLED', '任务已取消');
          requireThat(
            current.httpUsed < current.httpLimit,
            'BUDGET_EXHAUSTED',
            '调用预算已耗尽，请增加额度后恢复',
          );
          if (maxHttp !== undefined)
            requireThat(
              localUsed < maxHttp && current.httpLimit - current.httpUsed > 12,
              'OPTIONAL_BUDGET',
              '可选审核额度耗尽',
            );
          await tx.job.update({ where: { id: j.id }, data: { httpUsed: { increment: 1 } } });
          localUsed++;
        });
      },
      onText: async (text) => {
        await this.db.job.update({
          where: { id: j.id },
          data: { generationText: text, generationComplete: false },
        });
        await this.emit(j.id, 'draft', { codePointLength: [...text].length });
      },
      onUsage: async (usage) => {
        await this.emit(j.id, 'usage', usage);
      },
    });
  }
  private async execute(initial: Job) {
    const controller = new AbortController();
    this.controllers.set(initial.id, controller);
    const j = await this.db.$transaction(async (tx) => {
      const current = await tx.job.findUniqueOrThrow({ where: { id: initial.id } });
      if (current.status !== 'QUEUED' || current.cancelRequested) return null;
      return tx.job.update({
        where: { id: current.id },
        data: { status: 'RUNNING', attempt: { increment: 1 }, revision: { increment: 1 } },
      });
    });
    if (!j) {
      this.controllers.delete(initial.id);
      return;
    }
    try {
      if (!j.projectId) await runLibrary(this.db, j, (...args) => this.call(...args));
      else if (j.kind === 'BATCH') await scheduleBatch(this.db, j.id);
      else if (j.kind === 'OPENING') await this.opening(j);
      else if (j.kind === 'PLAN_ACTIVATE') await this.activatePlans(j);
      else await this.chapter(j);
    } catch (error) {
      const e =
        error instanceof AppError
          ? error
          : new AppError(
              'EXECUTION_FAILED',
              error instanceof z.ZodError
                ? '数据未满足结构约束'
                : '任务未完成，请检查阶段记录后恢复',
            );
      await this.db.$transaction(async (tx) => {
        const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
        if (['SUCCEEDED', 'CANCELLED', 'PAUSED'].includes(latest.status)) return;
        const status = latest.cancelRequested
          ? 'CANCELLED'
          : this.stopped
            ? 'INTERRUPTED'
            : ['WAITING_USER', 'PLAN_REVIEW_REQUIRED'].includes(e.code)
              ? 'WAITING_USER'
              : j.kind === 'BATCH'
                ? 'PAUSED'
                : 'FAILED';
        await tx.job.update({
          where: { id: j.id },
          data: {
            status,
            errorCode: e.code,
            errorMessage: e.message,
            revision: { increment: 1 },
          },
        });
        if (status === 'WAITING_USER' && j.projectId) {
          const refs = latest.artifactRefs as Refs;
          const cause = e.details as { code?: string; message?: string } | undefined;
          await artifact(
            tx,
            j.projectId,
            'RECOVERY',
            {
              failedStage: latest.stage,
              code: cause?.code || e.code,
              message: cause?.message || e.message,
              candidateId: refs.CONTENT || null,
              adjustableInputs: ['BUDGET', 'DRAFT', 'KNOWLEDGE', 'AUTHORIZED_QUOTES'],
            },
            j.baseSnapshotId,
            j.id,
          );
        }
        if (j.parentId) {
          const parent = await tx.job.findUniqueOrThrow({ where: { id: j.parentId } });
          const parentStatus = parent.cancelRequested
            ? 'CANCELLED'
            : this.stopped
              ? 'INTERRUPTED'
              : 'PAUSED';
          await tx.job.update({
            where: { id: parent.id },
            data: {
              status: parentStatus,
              errorCode: e.code,
              errorMessage: `第${j.number}章未完成：${e.message}`,
              revision: { increment: 1 },
            },
          });
          await tx.jobEvent.create({
            data: {
              jobId: parent.id,
              type: 'error',
              payload: { childId: j.id, number: j.number, status: parentStatus, code: e.code },
            },
          });
        }
        await tx.activeCommand.deleteMany({ where: { jobId: j.parentId || j.id } });
        await tx.libraryCommand.deleteMany({ where: { jobId: j.id } });
      });
      await this.emit(j.id, 'error', { code: e.code, message: e.message });
    } finally {
      this.controllers.delete(j.id);
    }
  }
  private async opening(j: Job) {
    requireThat(j.projectId, 'INVALID_JOB', '开书任务需要小说');
    await this.stage(j.id, 'OPENING');
    const project = await this.db.project.findUniqueOrThrow({ where: { id: j.projectId } });
    const knowledge = (j.input as { knowledge?: KnowledgeContext }).knowledge || {
      items: [],
      hash: hash([]),
    };
    const refs = j.artifactRefs as Refs;
    const canonId = uuid();
    let candidate = refs.OPENING
      ? await getArtifact<Opening>(this.db, refs.OPENING)
      : await this.call(
          j,
          'planning.book',
          { project, projectId: project.id, canonId, knowledge },
          openingSchema,
        );
    if (!refs.OPENING)
      candidate = remapProposal(
        candidate,
        identifiers({ projectId: project.id, canonId, knowledge }),
      );
    candidate.book.knowledgeVersionIds = knowledge.items.map((i) => i.versionId);
    validateOpeningKnowledge(candidate, knowledge);
    validateOpening(candidate, project.id);
    validateBook(candidate, project.targetCount);
    const id = refs.OPENING || (await this.saveArtifact(j, 'OPENING', candidate));
    const validation = await this.call(
      j,
      'planning.validate',
      { project, opening: candidate, knowledge },
      planningValidationSchema,
    );
    await this.saveArtifact(j, 'OPENING_VALIDATION', validation);
    requireThat(
      !validation.violations.length && !validation.uncertain.length,
      'PLAN_INVALID',
      '开书方案存在冲突，请修改候选或重新生成',
    );
    await this.db.$transaction(async (tx) => {
      const latest = await tx.job.findUniqueOrThrow({ where: { id: j.id } });
      requireThat(!latest.cancelRequested, 'CANCELLED', '已取消');
      await tx.job.update({
        where: { id: j.id },
        data: { status: 'SUCCEEDED', stage: 'SUCCEEDED', revision: { increment: 1 } },
      });
      await tx.activeCommand.delete({ where: { projectId: project.id } });
    });
    await this.emit(j.id, 'done', { openingId: id });
  }
  private async activatePlans(j: Job) {
    await this.stage(j.id, 'PLANNING');
    const p = await this.db.project.findUniqueOrThrow({ where: { id: j.projectId! } });
    const ids = (j.input as { versionIds: string[] }).versionIds;
    const rows = await this.db.planVersion.findMany({
      where: { projectId: p.id, id: { in: ids }, status: 'CANDIDATE' },
    });
    requireThat(rows.length === ids.length, 'STALE_INPUT', '待启用计划已变化');
    const base = await loadSnapshot(this.db, p.headSnapshotId!, p.id);
    const parents = await this.db.planVersion.findMany({
      where: { projectId: p.id, status: 'ACTIVE' },
    });
    const validation = await this.call(
      j,
      'planning.validate',
      {
        project: p,
        plans: rows.map(readPlan),
        parents: parents.map(readPlan),
        state: base.state,
        versions: base.versions,
        knowledge: await resolveKnowledge(this.db, p.id),
      },
      planningValidationSchema,
    );
    const validationId = await this.saveArtifact(j, 'PLAN_VALIDATION', validation);
    requireThat(
      !validation.violations.length && !validation.uncertain.length,
      'PLAN_INVALID',
      '计划与事实或父目标冲突，请修订后重新确认',
    );
    await this.db.$transaction(async (tx) => {
      await activatePlanVersions(tx, p.id, ids, validationId, j.id);
      await tx.job.update({
        where: { id: j.id },
        data: { status: 'SUCCEEDED', stage: 'SUCCEEDED', revision: { increment: 1 } },
      });
      await tx.activeCommand.delete({ where: { projectId: p.id } });
      await tx.jobEvent.create({
        data: { jobId: j.id, type: 'done', payload: { versionIds: ids } },
      });
    });
  }
  async saveOpeningCandidate(projectId: string, revision: number, payload: unknown) {
    const candidate = openingSchema.parse(payload);
    validateOpening(candidate, projectId);
    return this.db.$transaction(async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      requireThat(p.revision === revision, 'REVISION_CONFLICT', '开书状态已改变', 409);
      requireThat(p.headChapter === 0, 'REWRITE_REQUIRED', '已有正式正文，请先从第一章重写', 409);
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '请等待当前任务结束',
        409,
      );
      requireThat(
        candidate.book.basedOnSnapshotId === null ||
          candidate.book.basedOnSnapshotId === p.headSnapshotId,
        'STALE_INPUT',
        '方案引用的初始状态已过期',
        409,
      );
      requireThat(
        candidate.book.assumptions.every(
          (a) => a.basedOnSnapshotId === null || a.basedOnSnapshotId === p.headSnapshotId,
        ),
        'STALE_INPUT',
        '前提引用的初始状态已过期',
        409,
      );
      const opening = p.headSnapshotId ? forkInitialOpening(candidate) : candidate;
      validateOpening(opening, projectId);
      validateBook(opening, p.targetCount);
      validateOpeningKnowledge(opening, await resolveKnowledge(tx, projectId));
      const a = await artifact(tx, projectId, 'OPENING', opening, p.headSnapshotId);
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      return a;
    });
  }
  async confirmOpening(
    projectId: string,
    openingId: string,
    revision: number,
    acknowledgedWarnings: string[],
  ) {
    const opening = openingSchema.parse(await getArtifact(this.db, openingId, projectId));
    validateOpening(opening, projectId);
    requireThat(
      opening.warnings.every((w) => acknowledgedWarnings.includes(w)),
      'CANON_WARNINGS',
      '请逐项确认开书警告',
    );
    const checkpoint = pack(opening.state),
      snapshotId = uuid();
    return this.db.$transaction(async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      requireThat(p.revision === revision, 'REVISION_CONFLICT', '开书状态已变化', 409);
      requireThat(p.headChapter === 0, 'REWRITE_REQUIRED', '已有正式正文，请先从第一章重写', 409);
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '存在活动任务',
        409,
      );
      validateBook(opening, p.targetCount);
      const source = await tx.artifact.findUnique({ where: { id: openingId } });
      requireThat(
        source?.baseSnapshotId === p.headSnapshotId,
        'STALE_INPUT',
        '候选的初始状态已过期，请重新编辑保存',
        409,
      );
      requireThat(
        source &&
          source.projectId === projectId &&
          source.kind === 'OPENING' &&
          source.hash === hash(opening) &&
          hash(source.payload) === source.hash,
        'ARTIFACT_CORRUPTED',
        '开书候选已变化或来源无效',
      );
      requireThat(
        opening.book.basedOnSnapshotId === null &&
          opening.book.assumptions.every((a) => a.basedOnSnapshotId === null),
        'INVALID_ASSUMPTION',
        '开书候选不得引用已有快照，请修订计划前提',
      );
      const checks = assumptionChecks(
        opening.book,
        opening.state,
        Object.fromEntries(opening.propositionVersions.map((v) => [v.id, v])),
      );
      const failed = checks.filter((c) => c.result !== 'MATCH');
      requireThat(
        failed.length === 0,
        'OPENING_ASSUMPTIONS',
        `开书前提不成立或无法确认，请修订候选：${failed
          .map((c) => opening.book.assumptions.find((a) => a.id === c.assumptionId)!.reason)
          .join('；')}`,
      );
      const currentKnowledge = await resolveKnowledge(tx, projectId);
      validateOpeningKnowledge(opening, currentKnowledge);
      const state = opening.state;
      await tx.snapshot.create({
        data: {
          id: snapshotId,
          projectId,
          chapterNo: 0,
          canonId: state.canonVersionId,
          stateHash: hash(state),
          checkpoint,
        },
      });
      for (const v of opening.propositionVersions)
        await tx.propositionVersion.create({
          data: {
            id: v.id,
            projectId,
            propositionId: v.propositionId,
            snapshotId,
            payload: asJson(v),
          },
        });
      await tx.chapter.upsert({
        where: { projectId_number: { projectId, number: 1 } },
        create: { id: uuid(), projectId, number: 1, title: '第一章' },
        update: { status: 'PLANNED', revision: { increment: 1 } },
      });
      const formalBook = await ensureBookPlan(
        tx,
        { ...p, headSnapshotId: snapshotId, chainEpoch: p.chainEpoch + (p.headSnapshotId ? 1 : 0) },
        {
          ...opening,
          book: {
            ...opening.book,
            basedOnSnapshotId: snapshotId,
            assumptions: opening.book.assumptions.map((a) => ({
              ...a,
              basedOnSnapshotId: snapshotId,
            })),
          },
        },
        currentKnowledge.hash,
        { reset: true },
      );
      const confirmed = await artifact(
        tx,
        projectId,
        'OPENING',
        {
          ...opening,
          adaptationMap: opening.adaptationMap.map((m) => ({
            ...m,
            newPlanNodeId: m.newPlanNodeId === opening.book.id ? formalBook.id : m.newPlanNodeId,
          })),
          book: {
            ...formalBook,
            basedOnSnapshotId: snapshotId,
            assumptions: opening.book.assumptions.map((a) => ({
              ...a,
              basedOnSnapshotId: snapshotId,
            })),
          },
        },
        snapshotId,
      );
      await artifact(
        tx,
        projectId,
        'OPENING_CONFIRMATION',
        {
          sourceOpeningId: openingId,
          sourceHash: source.hash,
          confirmedOpeningId: confirmed.id,
          snapshotId,
          previousSnapshotId: p.headSnapshotId,
          previousOpeningId: p.openingId,
          checks,
        },
        snapshotId,
      );
      return tx.project.update({
        where: { id: projectId },
        data: {
          openingId: confirmed.id,
          headSnapshotId: snapshotId,
          status: 'READY',
          ...(p.headSnapshotId ? { chainEpoch: { increment: 1 } } : {}),
          revision: { increment: 1 },
        },
      });
    });
  }
  private async chapter(j: Job) {
    requireThat(j.projectId, 'INVALID_JOB', '章节任务需要小说');
    const p = await this.db.project.findUniqueOrThrow({ where: { id: j.projectId } });
    requireThat(
      p.headSnapshotId === j.baseSnapshotId && p.chainEpoch === j.chainEpoch,
      'STALE_INPUT',
      '故事基础已变化',
      409,
    );
    const base = await loadSnapshot(this.db, j.baseSnapshotId!, p.id),
      opening = await getArtifact<Opening>(this.db, p.openingId!, p.id);
    opening.book = await this.db.$transaction((tx) =>
      ensureBookPlan(
        tx,
        p,
        opening,
        ((j.input as { knowledge?: KnowledgeContext }).knowledge || { hash: hash([]) }).hash,
      ),
    );
    requireThat(
      (j.input as { planRevision?: number }).planRevision === undefined
        ? p.planRevision === 0
        : (j.input as { planRevision: number }).planRevision === p.planRevision,
      'STALE_INPUT',
      '计划已改变，请创建新任务',
    );
    const knowledge = (j.input as { knowledge?: KnowledgeContext }).knowledge || {
      items: [],
      hash: hash([]),
    };
    const authorizedQuotes = (
      j.input as {
        authorizedQuotes?: {
          items: { text: string; sourceRef: { kind: string; id: string; versionId: string } }[];
          hash: string;
        };
      }
    ).authorizedQuotes || { items: [], hash: hash([]) };
    const knowledgeIds = knowledge.items.map((i) => i.versionId).sort();
    const sourceTexts = await referenceTextSources(this.db, knowledge);
    const bannedPhrases = knowledge.items
      .filter((i) => i.kind === 'STYLE')
      .flatMap((i) => i.payload.bannedPhrases as string[]);
    let refs = { ...(j.artifactRefs as Refs) };
    const frozen = j.config as unknown as FrozenConfig,
      policy = validatePolicy(frozen.policy.payload);
    let plan: ChapterPlan;
    let rolling:
      | { volume: z.infer<typeof volumeSchema>; arc: z.infer<typeof arcSchema> }
      | undefined;
    if (refs.ROLLING) {
      const payload = rollingSchema.parse(await getArtifact(this.db, refs.ROLLING, p.id));
      rolling = { volume: payload.volume, arc: payload.arc };
    }
    if (refs.PLAN) plan = await getArtifact<ChapterPlan>(this.db, refs.PLAN, p.id);
    else {
      await this.stage(j.id, 'PLANNING');
      const n = j.number!,
        volumeDirection = opening.book.volumeDirections.find(
          (d) => d.chapterRange[0] <= n && d.chapterRange[1] >= n,
        )!;
      const activeLayers = await activePlanLayers(
        this.db,
        p,
        opening.book,
        n,
        base.ancestorIds,
        knowledge.hash,
      );
      const plannedArc = activeLayers.volume?.arcDirections.find(
        (d) => d.chapterRange[0] <= n && d.chapterRange[1] >= n,
      );
      const arcEnd =
        plannedArc?.chapterRange[1] ??
        Math.min(
          volumeDirection.chapterRange[1],
          volumeDirection.chapterRange[0] +
            Math.floor((n - volumeDirection.chapterRange[0]) / 10) * 10 +
            9,
        );
      const cached =
        activeLayers.volume &&
        activeLayers.arc &&
        activeLayers.chapters[0]?.chapterRange[0] === n &&
        (activeLayers.chapters.length >= 2 || n === arcEnd)
          ? { plan: activeLayers.chapters[0], volume: activeLayers.volume, arc: activeLayers.arc }
          : undefined;
      if (cached) {
        plan = cached.plan;
        rolling = { volume: cached.volume, arc: cached.arc };
        refs.ROLLING = await this.saveArtifact(j, 'ROLLING', {
          volume: cached.volume,
          arc: cached.arc,
          chapters: [cached.plan],
        });
        refs.PLAN = await this.saveArtifact(j, 'PLAN', plan);
      } else {
        let plans = await this.call(
          j,
          'planning.rolling',
          {
            project: p,
            book: opening.book,
            state: base.state,
            versions: base.versions,
            baseSnapshotId: base.meta.id,
            existingVolume: activeLayers.volume,
            existingArc: activeLayers.arc,
            requestedRange: [n, Math.min(n + 4, activeLayers.arc?.chapterRange[1] ?? arcEnd)],
            targetLength: p.targetLength,
            knowledge,
          },
          rollingSchema,
        );
        plans = remapProposal(
          plans,
          identifiers({
            opening,
            state: base.state,
            versions: base.versions,
            baseSnapshotId: base.meta.id,
            knowledge,
          }),
        );
        if (activeLayers.volume) {
          plans.arc.parentVersionId = activeLayers.volume.id;
          plans.volume = activeLayers.volume;
        }
        if (activeLayers.arc) {
          plans.chapters.forEach((c) => (c.parentVersionId = activeLayers.arc!.id));
          plans.arc = activeLayers.arc;
        }
        plans.chapters = plans.chapters.map(
          (c) =>
            activeLayers.chapters.find((old) => old.chapterRange[0] === c.chapterRange[0]) || c,
        );
        for (const layer of [plans.volume, plans.arc]) {
          if (![activeLayers.volume?.id, activeLayers.arc?.id].includes(layer.id)) {
            layer.basedOnSnapshotId = base.meta.id;
            layer.knowledgeVersionIds = [...knowledgeIds];
            layer.assumptions = layer.assumptions.map((a) => ({
              ...a,
              basedOnSnapshotId: base.meta.id,
            }));
          }
        }
        requireThat(
          plans.chapters.length ===
            Math.min(5, (activeLayers.arc?.chapterRange[1] ?? arcEnd) - n + 1) &&
            plans.chapters.every(
              (c, i) =>
                c.chapterRange[0] === n + i &&
                c.chapterRange[1] === n + i &&
                c.targetLength === p.targetLength &&
                (c.basedOnSnapshotId === base.meta.id ||
                  activeLayers.chapters.some((old) => old.id === c.id)) &&
                c.parentVersionId === plans.arc.id,
            ),
          'INVALID_PLAN',
          '滚动章计划范围、长度或父引用错误',
        );
        requireThat(
          plans.arc.parentVersionId === plans.volume.id &&
            plans.volume.parentVersionId === opening.book.id,
          'INVALID_PLAN',
          '卷/Arc父引用错误',
        );
        requireThat(
          plans.volume.chapterRange[0] === volumeDirection.chapterRange[0] &&
            plans.volume.chapterRange[1] === volumeDirection.chapterRange[1] &&
            plans.arc.chapterRange[0] <= n &&
            plans.arc.chapterRange[1] === (activeLayers.arc?.chapterRange[1] ?? arcEnd),
          'INVALID_PLAN',
          '卷/Arc范围错误',
        );
        for (const c of plans.chapters) {
          if (activeLayers.chapters.some((old) => old.id === c.id)) continue;
          c.knowledgeVersionIds = [...knowledgeIds];
          c.allowedQuotes = authorizedQuotes.items.map((q) => ({
            text: q.text,
            sourceRef: q.sourceRef,
          }));
          validateConstraints(plans.volume);
          validateConstraints(plans.arc);
          validateConstraints(c);
          for (const characterId of c.castIds) {
            requireThat(
              base.state.characters[characterId],
              'STATE_CONTEXT_UNRESOLVED',
              '计划角色不是已确认实体',
            );
            if (
              base.state.characters[characterId].life === 'ALIVE' &&
              !c.assumptions.some(
                (a) =>
                  a.selector.collection === 'characters' &&
                  a.selector.key === characterId &&
                  a.selector.field === 'life',
              )
            )
              c.assumptions.push({
                id: uuid(),
                selector: { collection: 'characters', key: characterId, field: 'life' },
                operator: 'EQUALS',
                expected: 'ALIVE',
                importance: 'HARD',
                reason: '角色以存活身份参与本章行动',
                basedOnSnapshotId: base.meta.id,
              });
          }
          for (const locationId of c.locationIds) {
            requireThat(
              base.state.locations[locationId],
              'STATE_CONTEXT_UNRESOLVED',
              '计划地点不存在',
            );
            if (
              base.state.locations[locationId].accessible === true &&
              !c.assumptions.some(
                (a) =>
                  a.selector.collection === 'locations' &&
                  a.selector.key === locationId &&
                  a.selector.field === 'accessible',
              )
            )
              c.assumptions.push({
                id: uuid(),
                selector: { collection: 'locations', key: locationId, field: 'accessible' },
                operator: 'EQUALS',
                expected: true,
                importance: 'HARD',
                reason: '计划以地点可进入为前提',
                basedOnSnapshotId: base.meta.id,
              });
          }
        }
        const validation = await this.call(
          j,
          'planning.validate',
          { project: p, book: opening.book, plans, state: base.state, knowledge },
          planningValidationSchema,
        );
        const planValidationId = await this.saveArtifact(j, 'PLAN_VALIDATION', validation);
        requireThat(
          !validation.violations.length && !validation.uncertain.length,
          'PLAN_INVALID',
          '章节规划与事实或父目标冲突',
        );
        await this.db.$transaction((tx) =>
          registerRolling(tx, p.id, plans, planValidationId, j.id),
        );
        refs.ROLLING = await this.saveArtifact(j, 'ROLLING', plans);
        rolling = { volume: plans.volume, arc: plans.arc };
        plan = plans.chapters[0];
        refs.PLAN = await this.saveArtifact(j, 'PLAN', plan);
      }
    }
    validateConstraints(opening.book);
    if (rolling) {
      validateConstraints(rolling.volume);
      validateConstraints(rolling.arc);
    }
    validateConstraints(plan);
    plan.allowedQuotes = authorizedQuotes.items.map((q) => ({
      text: q.text,
      sourceRef: q.sourceRef,
    }));
    const effectiveConstraints = effectiveHardConstraints(
      [opening.book, ...(rolling ? [rolling.volume, rolling.arc] : []), plan],
      j.number!,
    );
    const checks = [opening.book, ...(rolling ? [rolling.volume, rolling.arc] : []), plan].flatMap(
      (layer) => assumptionChecks(layer, base.state, base.versions),
    );
    const boundIds = [
      opening.book.id,
      ...(rolling ? [rolling.volume.id, rolling.arc.id] : []),
      plan.id,
    ];
    const boundVersions = await this.db.planVersion.findMany({
      where: { projectId: p.id, id: { in: boundIds }, status: 'ACTIVE' },
    });
    requireThat(
      boundVersions.length === boundIds.length &&
        boundVersions.every((v) => hash(v.payload) === v.hash),
      'STALE_INPUT',
      '章节引用的计划版本已失效，请重新规划',
    );
    await this.saveArtifact(j, 'PLAN_BINDING', {
      planRevision: p.planRevision,
      versions: boundVersions.map((v) => ({ id: v.id, hash: v.hash })),
      executionPlanHash: hash(plan),
    });
    await this.saveArtifact(j, 'PLAN_REVIEW', checks);
    requireThat(
      checks.every((c) => c.result === 'MATCH'),
      'PLAN_ASSUMPTION_CHANGED',
      '计划前提已改变，需要重新规划',
    );
    await this.db.planningRecheck.updateMany({
      where: { projectId: p.id, snapshotId: { in: base.ancestorIds } },
      data: { processed: true },
    });
    const chapter = await this.db.chapter.upsert({
      where: { projectId_number: { projectId: p.id, number: j.number! } },
      create: { id: uuid(), projectId: p.id, number: j.number!, title: plan.title },
      update: { title: plan.title },
    });
    const past = await this.db.chapter.findMany({
      where: { projectId: p.id, number: { lt: j.number! }, activeContentId: { not: null } },
      orderBy: { number: 'desc' },
      take: 5,
    });
    const recent = await Promise.all(
      past.map((c) => this.db.content.findUniqueOrThrow({ where: { id: c.activeContentId! } })),
    );
    const skills = (frozen.skills.payload as typeof defaultSkills)
      .filter(
        (s) =>
          s.enabled &&
          (!s.applicable.genres.length || s.applicable.genres.includes(p.genre)) &&
          (!s.applicable.chapterRange ||
            (j.number! >= s.applicable.chapterRange[0] &&
              j.number! <= s.applicable.chapterRange[1])) &&
          (!s.applicable.chapterFunctions.length ||
            plan.beats.some((b) => s.applicable.chapterFunctions.includes(b.function))),
      )
      .sort((a, b) => b.priority - a.priority || a.skillId.localeCompare(b.skillId))
      .map((s) => ({
        ...s,
        instructions: skillDefinitions.find((d) => d.id === s.skillId)?.instructions,
      }));
    const context = {
      project: { idea: p.idea, genre: p.genre, requirements: p.requirements },
      book: opening.book,
      volume: rolling?.volume || null,
      arc: rolling?.arc || null,
      plan,
      ...resolveStateContext(plan, base.state, base.versions),
      recent: recent.slice(0, 2).map((c) => ({ id: c.id, text: c.text })),
      style:
        knowledge.items.find((i) => i.kind === 'STYLE')?.payload ||
        '清晰、具体、少空泛修辞；以行动和对白承载信息。',
      knowledge,
      skills,
    };
    const contextId = refs.CONTEXT || (await this.saveArtifact(j, 'CONTEXT', context));
    let content = refs.CONTENT
      ? await this.db.content.findUniqueOrThrow({ where: { id: refs.CONTENT } })
      : null;
    if (!content) {
      await this.stage(j.id, 'WRITING');
      const input = j.input as { mode?: string; text?: string };
      const raw =
        input.mode === 'AUDIT_DRAFT'
          ? input.text!
          : await this.call<string>(j, 'production.write', context);
      content = await this.db.content.create({
        data: {
          id: uuid(),
          chapterId: chapter.id,
          text: normalize(raw),
          hash: hash(normalize(raw)),
          origin: input.mode === 'AUDIT_DRAFT' ? 'MANUAL' : 'GENERATED',
          contextId,
        },
      });
      await this.saveRef(j.id, 'CONTENT', content.id);
      await this.db.job.update({
        where: { id: j.id },
        data: { generationText: content.text, generationComplete: true },
      });
    }
    let evaluation:
      | { status: string; results: EvaluatorResult[]; contentId: string; policyVersionId: string }
      | undefined;
    let x: Extraction | undefined;
    let simulation: typeof base.state | undefined;
    let validationId = '';
    chapterAttempt: for (;;) {
      for (;;) {
        await this.stage(j.id, 'EVALUATING');
        const requirements = p.requirements as { must: string[]; avoid: string[] };
        const requiredIds = [
          ...effectiveConstraints.map((c) => c.id),
          ...plan.goals.filter((g) => g.required).map((g) => g.id),
          ...plan.promiseActions.filter((a) => a.required).map((a) => a.promiseId),
          ...requirements.must.map((_, i) => `requirement:must:${i}`),
          ...requirements.avoid.map((_, i) => `requirement:avoid:${i}`),
        ];
        const response = await this.call(
          j,
          'evaluation.run',
          {
            context,
            contentId: content.id,
            text: content.text,
            requiredConstraintIds: requiredIds,
            requestedEvaluators: evaluators.filter((e) =>
              policy.requiredEvaluatorIds.includes(e.id),
            ),
          },
          evaluationResponseSchema,
        );
        validateResults(
          response.results,
          policy.requiredEvaluatorIds,
          content.text,
          content.id,
          policy,
        );
        const hard = response.results.find((r) => r.evaluatorId === 'core.hard-constraints')!;
        requireThat(
          requiredIds.every((id) => hard.checkedConstraintIds.includes(id)),
          'EVALUATOR_ERROR',
          '硬约束审核未逐项覆盖',
        );
        const local = deterministicIssues(
          content.text,
          content.id,
          plan,
          [...recent.map((c) => ({ text: c.text, textVersionId: c.id })), ...sourceTexts],
          bannedPhrases,
          effectiveConstraints,
        );
        hard.issues.push(...local);
        if (local.length) hard.score = 0;
        if (policy.optionalEvaluatorIds.length) {
          const latest = await this.db.job.findUniqueOrThrow({ where: { id: j.id } });
          if (latest.httpLimit - latest.httpUsed >= 14) {
            try {
              const optional = await this.call(
                j,
                'evaluation.run',
                {
                  context,
                  contentId: content.id,
                  text: content.text,
                  requestedEvaluators: evaluators.filter((e) =>
                    policy.optionalEvaluatorIds.includes(e.id),
                  ),
                },
                evaluationResponseSchema,
                2,
              );
              validateResults(
                optional.results,
                policy.optionalEvaluatorIds,
                content.text,
                content.id,
                policy,
              );
              response.results.push(...optional.results);
            } catch {
              for (const id of policy.optionalEvaluatorIds)
                response.results.push({
                  evaluatorId: id,
                  evaluatorVersion: '1',
                  executionStatus: 'ERROR',
                  score: null,
                  issues: [],
                  metrics: {},
                  reason: '可选审核未完成',
                  checkedConstraintIds: [],
                  errorCode: 'OPTIONAL_ERROR',
                });
            }
          }
        }
        evaluation = {
          status: gate(response.results, policy),
          results: response.results,
          contentId: content.id,
          policyVersionId: frozen.policy.versionId,
        };
        refs.EVALUATION = await this.saveArtifact(j, 'EVALUATION', evaluation);
        if (evaluation.status === 'PASS') break;
        const latest = await this.db.job.findUniqueOrThrow({ where: { id: j.id } });
        requireThat(
          latest.bodyRepairs < latest.bodyRepairLimit,
          'BODY_REPAIR_EXHAUSTED',
          '正文修复次数已耗尽，请查看问题并调整草稿或额度',
        );
        await this.db.job.update({ where: { id: j.id }, data: { bodyRepairs: { increment: 1 } } });
        await this.stage(j.id, 'REVISING');
        const revised = normalize(
          await this.call<string>(j, 'production.revise', {
            context,
            text: content.text,
            issues: response.results
              .filter((r) => policy.requiredEvaluatorIds.includes(r.evaluatorId))
              .flatMap((r) => r.issues)
              .filter((i) => i.severity !== 'INFO'),
          }),
        );
        content = await this.db.content.create({
          data: {
            id: uuid(),
            chapterId: chapter.id,
            text: revised,
            hash: hash(revised),
            origin: 'REVISED',
            parentId: content.id,
            contextId,
          },
        });
        await this.saveRef(j.id, 'CONTENT', content.id);
        await this.db.job.update({
          where: { id: j.id },
          data: { generationText: content.text, generationComplete: true },
        });
      }
      x = undefined;
      simulation = undefined;
      validationId = '';
      let failure: { code: string; message: string } | null = null;
      for (;;) {
        await this.stage(j.id, 'EXTRACTING_STATE_DELTA');
        x = await this.call(
          j,
          failure ? 'state.repair' : 'state.extract',
          {
            contentId: content.id,
            text: content.text,
            baseSnapshotId: base.meta.id,
            state: base.state,
            propositionVersions: base.versions,
            previous: x ?? null,
            errors: failure,
          },
          extractionSchema,
        );
        x = remapProposal(
          x,
          identifiers({
            opening,
            state: base.state,
            versions: base.versions,
            contentId: content.id,
            baseSnapshotId: base.meta.id,
          }),
        );
        await this.saveArtifact(j, 'EXTRACTION', x);
        try {
          simulation = simulate(
            base.state,
            base.meta.id,
            x,
            content.text,
            content.id,
            base.versions,
            true,
          );
          const simulatedVersions = {
            ...base.versions,
            ...Object.fromEntries(x.delta.propositionVersions.map((v) => [v.id, v])),
          };
          const stateConstraintIssues = deterministicStateConstraintIssues(
            base.state,
            simulation,
            simulatedVersions,
            effectiveConstraints,
          );
          requireThat(
            stateConstraintIssues.length === 0,
            'STATE_CONSTRAINT_FAILED',
            `状态硬约束未满足：${stateConstraintIssues.map((i) => i.constraintId).join(', ')}`,
          );
          await this.stage(j.id, 'VALIDATING_STATE');
          const validation = await this.call(
            j,
            'state.validate',
            {
              text: content.text,
              contentId: content.id,
              base: base.state,
              propositionVersions: base.versions,
              extraction: x,
              simulation,
            },
            stateValidationSchema,
          );
          const savedValidation = { ...validation, input: validationInput(x) };
          validationId = await this.saveArtifact(j, 'STATE_VALIDATION', savedValidation);
          checkStateValidation(savedValidation, x, content.text, base.state);
          break chapterAttempt;
        } catch (e) {
          failure =
            e instanceof AppError
              ? { code: e.code, message: e.message }
              : { code: 'INVALID_STATE', message: '状态schema或引用无效' };
          const latest = await this.db.job.findUniqueOrThrow({ where: { id: j.id } });
          if (this.stateFailureNeedsBodyRepair(failure)) {
            if (latest.bodyRepairs >= latest.bodyRepairLimit)
              throw new AppError(
                'WAITING_USER',
                `正文与既定事实或不可变规则冲突，自动修正文已耗尽；最后错误：${failure.message}`,
                422,
                failure,
              );
            await this.db.job.update({
              where: { id: j.id },
              data: { bodyRepairs: { increment: 1 } },
            });
            await this.stage(j.id, 'REVISING');
            const revised = normalize(
              await this.call<string>(j, 'production.revise', {
                context,
                text: content.text,
                issues: [this.stateFailureIssue(failure, content.id)],
              }),
            );
            content = await this.db.content.create({
              data: {
                id: uuid(),
                chapterId: chapter.id,
                text: revised,
                hash: hash(revised),
                origin: 'REVISED',
                parentId: content.id,
                contextId,
              },
            });
            await this.saveRef(j.id, 'CONTENT', content.id);
            await this.db.job.update({
              where: { id: j.id },
              data: { generationText: content.text, generationComplete: true },
            });
            continue chapterAttempt;
          }
          if (latest.deltaRepairs >= latest.deltaRepairLimit)
            throw new AppError(
              'DELTA_REPAIR_EXHAUSTED',
              `状态修复次数已耗尽，正式事实未改动；最后错误：${failure.message}`,
            );
          await this.db.job.update({
            where: { id: j.id },
            data: { deltaRepairs: { increment: 1 } },
          });
        }
      }
    }
    await this.stage(j.id, 'COMMITTING');
    await commitChapter(
      this.db,
      j,
      chapter.id,
      content.id,
      evaluation!,
      refs.EVALUATION,
      x!,
      simulation!,
      validationId,
    );
    await this.emit(j.id, 'done', { chapter: chapter.number });
  }
}
