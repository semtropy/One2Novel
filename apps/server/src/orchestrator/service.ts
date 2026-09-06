import { commitChapter } from '../production/commit.js';
import { scheduleBatch, retryBatch, pauseBatch } from './batch.js';
import { loadSnapshot, pack } from '../story-state/snapshot.js';
import { z } from 'zod';
import {
  openingSchema,
  rollingSchema,
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
import type { PromptId } from '../platform/prompts.js';
import { assumptionChecks, checkSpan, simulate, validateOpening } from '../story-state/service.js';
import { validateBook, validateConstraints } from '../planning/service.js';
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
    kind: 'OPENING' | 'CHAPTER' | 'BATCH',
    revision: number,
    key: string,
    input: Record<string, unknown> = {},
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
      requestHash = hash({ revision, input });
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
      await tx.receipt.create({
        data: { id: uuid(), scope, key, requestHash, response: { id: job.id } },
      });
      return job;
    });
    return job;
  }
  async retry(jobId: string, revision: number) {
    return this.db.$transaction(async (tx) => {
      const j = await tx.job.findUniqueOrThrow({ where: { id: jobId } }),
        p = await tx.project.findUniqueOrThrow({ where: { id: j.projectId } });
      requireThat(!j.parentId, 'BATCH_CONTROL_REQUIRED', '请通过所属批次恢复当前章节', 409);
      requireThat(j.revision === revision, 'REVISION_CONFLICT', '任务已变化', 409);
      requireThat(
        ['FAILED', 'INTERRUPTED', 'PAUSED'].includes(j.status),
        'INVALID_JOB_STATE',
        '此任务不能恢复',
      );
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
      if (!running) await tx.activeCommand.deleteMany({ where: { jobId } });
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
    const a = await artifact(this.db, j.projectId, key, payload, j.baseSnapshotId, j.id);
    await this.saveRef(j.id, key, a.id);
    return a.id;
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
      config.promptVersion === '1' && config.stateRuleVersion === '1',
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
      if (j.kind === 'BATCH') await scheduleBatch(this.db, j.id);
      else if (j.kind === 'OPENING') await this.opening(j);
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
      });
      await this.emit(j.id, 'error', { code: e.code, message: e.message });
    } finally {
      this.controllers.delete(j.id);
    }
  }
  private async opening(j: Job) {
    await this.stage(j.id, 'OPENING');
    const project = await this.db.project.findUniqueOrThrow({ where: { id: j.projectId } });
    const refs = j.artifactRefs as Refs;
    const canonId = uuid();
    let candidate = refs.OPENING
      ? await getArtifact<Opening>(this.db, refs.OPENING)
      : await this.call(
          j,
          'planning.book',
          { project, projectId: project.id, canonId },
          openingSchema,
        );
    if (!refs.OPENING) candidate = remapProposal(candidate, new Set([project.id, canonId]));
    validateOpening(candidate, project.id);
    validateBook(candidate, project.targetCount);
    const id = refs.OPENING || (await this.saveArtifact(j, 'OPENING', candidate));
    const validation = await this.call(
      j,
      'planning.validate',
      { project, opening: candidate },
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
      await tx.activeCommand.delete({ where: { projectId: j.projectId } });
    });
    await this.emit(j.id, 'done', { openingId: id });
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
      requireThat(
        p.revision === revision && !p.headSnapshotId,
        'REVISION_CONFLICT',
        '开书状态已变化',
        409,
      );
      requireThat(
        !(await tx.activeCommand.findUnique({ where: { projectId } })),
        'PROJECT_BUSY',
        '存在活动任务',
        409,
      );
      validateBook(opening, p.targetCount);
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
      await tx.chapter.create({ data: { id: uuid(), projectId, number: 1, title: '第一章' } });
      return tx.project.update({
        where: { id: projectId },
        data: {
          openingId,
          headSnapshotId: snapshotId,
          status: 'READY',
          revision: { increment: 1 },
        },
      });
    });
  }
  private async chapter(j: Job) {
    const p = await this.db.project.findUniqueOrThrow({ where: { id: j.projectId } });
    requireThat(
      p.headSnapshotId === j.baseSnapshotId && p.chainEpoch === j.chainEpoch,
      'STALE_INPUT',
      '故事基础已变化',
      409,
    );
    const base = await loadSnapshot(this.db, j.baseSnapshotId!, p.id),
      opening = await getArtifact<Opening>(this.db, p.openingId!, p.id);
    let refs = { ...(j.artifactRefs as Refs) };
    const frozen = j.config as unknown as FrozenConfig,
      policy = validatePolicy(frozen.policy.payload);
    let plan: ChapterPlan;
    if (refs.PLAN) plan = await getArtifact<ChapterPlan>(this.db, refs.PLAN, p.id);
    else {
      await this.stage(j.id, 'PLANNING');
      const n = j.number!,
        volumeDirection = opening.book.volumeDirections.find(
          (d) => d.chapterRange[0] <= n && d.chapterRange[1] >= n,
        )!;
      const arcEnd = Math.min(
        volumeDirection.chapterRange[1],
        volumeDirection.chapterRange[0] +
          Math.floor((n - volumeDirection.chapterRange[0]) / 10) * 10 +
          9,
      );
      const priorWindows = await this.db.artifact.findMany({
        where: { projectId: p.id, kind: 'ROLLING', baseSnapshotId: { in: base.ancestorIds } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      let cached: ChapterPlan | undefined;
      for (const window of priorWindows) {
        const parsed = rollingSchema.parse(window.payload);
        const remaining = parsed.chapters.filter(
          (c) =>
            c.chapterRange[0] >= n &&
            assumptionChecks(c, base.state, base.versions).every((a) => a.result === 'MATCH'),
        );
        if (
          (remaining.length >= 2 || n === arcEnd) &&
          remaining[0]?.chapterRange[0] === n &&
          parsed.volume.parentVersionId === opening.book.id
        ) {
          cached = remaining[0];
          break;
        }
      }
      if (cached) {
        plan = cached;
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
            requestedRange: [n, Math.min(n + 4, arcEnd)],
            targetLength: p.targetLength,
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
          }),
        );
        requireThat(
          plans.chapters.length === Math.min(5, arcEnd - n + 1) &&
            plans.chapters.every(
              (c, i) =>
                c.chapterRange[0] === n + i &&
                c.chapterRange[1] === n + i &&
                c.targetLength === p.targetLength &&
                c.basedOnSnapshotId === base.meta.id &&
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
            plans.arc.chapterRange[1] === arcEnd,
          'INVALID_PLAN',
          '卷/Arc范围错误',
        );
        for (const c of plans.chapters) {
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
          { project: p, book: opening.book, plans, state: base.state },
          planningValidationSchema,
        );
        await this.saveArtifact(j, 'PLAN_VALIDATION', validation);
        requireThat(
          !validation.violations.length && !validation.uncertain.length,
          'PLAN_INVALID',
          '章节规划与事实或父目标冲突',
        );
        await this.saveArtifact(j, 'ROLLING', plans);
        plan = plans.chapters[0];
        refs.PLAN = await this.saveArtifact(j, 'PLAN', plan);
      }
    }
    const checks = assumptionChecks(plan, base.state, base.versions);
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
      plan,
      ...resolveStateContext(plan, base.state, base.versions),
      recent: recent.slice(0, 2).map((c) => ({ id: c.id, text: c.text })),
      style: '清晰、具体、少空泛修辞；以行动和对白承载信息。',
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
    for (;;) {
      await this.stage(j.id, 'EVALUATING');
      const requirements = p.requirements as { must: string[]; avoid: string[] };
      const requiredIds = [
        ...plan.constraints.filter((c) => c.severity === 'HARD').map((c) => c.id),
        ...opening.book.constraints.filter((c) => c.severity === 'HARD').map((c) => c.id),
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
          requestedEvaluators: evaluators.filter((e) => policy.requiredEvaluatorIds.includes(e.id)),
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
        recent.map((c) => c.text),
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
    let x: Extraction | undefined;
    let simulation: typeof base.state | undefined;
    let validationId = '';
    let failure: unknown = null;
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
        validationId = await this.saveArtifact(j, 'STATE_VALIDATION', validation);
        requireThat(
          validation.checks.length === x.delta.changes.length &&
            new Set(validation.checks.map((c) => c.changeIndex)).size === x.delta.changes.length &&
            validation.checks.every(
              (c) => c.changeIndex < x!.delta.changes.length && c.verdict === 'PASS',
            ) &&
            !validation.missingChanges.length &&
            (x.delta.changes.length > 0 || validation.noStateChange),
          'STATE_VALIDATION_FAILED',
          '状态变化未通过独立验证',
        );
        for (const c of validation.checks)
          c.spans.forEach((s) => checkSpan(s, content!.id, content!.text));
        for (const [index, change] of x.delta.changes.entries())
          if (
            change.collection === 'characters' &&
            change.expected?.life === 'DEAD' &&
            change.values.life === 'ALIVE'
          ) {
            const proof = validation.revivalAuthorizations.find((p) => p.changeIndex === index);
            requireThat(
              proof && base.state.worldRules[proof.ruleId]?.active,
              'ILLEGAL_REVIVAL',
              '复活必须引用原基础状态中明确允许该行为的世界规则',
            );
            proof.spans.forEach((span) => checkSpan(span, content!.id, content!.text));
          }
        break;
      } catch (e) {
        failure =
          e instanceof AppError
            ? { code: e.code, message: e.message }
            : { code: 'INVALID_STATE', message: '状态schema或引用无效' };
        const latest = await this.db.job.findUniqueOrThrow({ where: { id: j.id } });
        requireThat(
          latest.deltaRepairs < latest.deltaRepairLimit,
          'DELTA_REPAIR_EXHAUSTED',
          '状态修复次数已耗尽，正式事实未改动',
        );
        await this.db.job.update({ where: { id: j.id }, data: { deltaRepairs: { increment: 1 } } });
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
