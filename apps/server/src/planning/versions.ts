import {
  planPayloadSchema,
  type PlanPayload,
  type Opening,
  type ChapterPlan,
  rollingSchema,
} from '@one2novel/contracts';
import type { Project, PlanVersion } from '@prisma/client';
import { z } from 'zod';
import type { DB, Tx } from '../platform/db.js';
import { asJson, hash, requireThat, uuid } from '../platform/core.js';
import { loadSnapshot } from '../story-state/snapshot.js';
import { assumptionChecks } from '../story-state/service.js';
import { resolveKnowledge } from '../knowledge/library.js';
import { validateBook, validateConstraints, effectiveHardConstraints } from './service.js';
type Rolling = z.infer<typeof rollingSchema>;
export const listPlans = (db: DB | Tx, projectId: string) =>
  db.planVersion.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
export function readPlan(row: PlanVersion): PlanPayload {
  requireThat(row.hash === hash(row.payload), 'ARTIFACT_CORRUPTED', '计划版本校验失败');
  const plan = planPayloadSchema.parse(row.payload);
  requireThat(
    plan.id === row.id && plan.parentVersionId === row.parentVersionId && plan.level === row.level,
    'ARTIFACT_CORRUPTED',
    '计划版本身份不一致',
  );
  return plan;
}
async function insert(
  tx: Tx,
  p: Project,
  plan: PlanPayload,
  knowledgeHash: string,
  status: string,
  extra: { validationId?: string; groupId?: string; supersedesVersionId?: string } = {},
) {
  return tx.planVersion.create({
    data: {
      id: plan.id,
      projectId: p.id,
      level: plan.level,
      parentVersionId: plan.parentVersionId,
      rangeStart: plan.chapterRange[0],
      rangeEnd: plan.chapterRange[1],
      payload: asJson(plan),
      hash: hash(plan),
      baseSnapshotId: plan.basedOnSnapshotId!,
      knowledgeHash,
      chainEpoch: p.chainEpoch,
      status,
      ...extra,
    },
  });
}
export async function ensureBookPlan(
  tx: Tx,
  p: Project,
  opening: Opening,
  knowledgeHash: string,
  options: { reset?: boolean } = {},
) {
  const rows = await tx.planVersion.findMany({
    where: { projectId: p.id, level: 'BOOK' },
    orderBy: { createdAt: 'desc' },
  });
  if (!options.reset && rows.length) {
    const active = rows.find(
      (r) =>
        r.status === 'ACTIVE' && r.chainEpoch === p.chainEpoch && r.knowledgeHash === knowledgeHash,
    );
    requireThat(active, 'PLAN_REVIEW_REQUIRED', '全书计划需要复核，请在计划管理中修订并确认');
    return readPlan(active) as Opening['book'];
  }
  requireThat(p.headSnapshotId, 'NOT_READY', '请先确认开书');
  if (options.reset)
    await tx.planVersion.updateMany({
      where: { projectId: p.id, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
      data: { status: 'STALE' },
    });
  const book = {
    ...opening.book,
    id: rows.length ? uuid() : opening.book.id,
    basedOnSnapshotId: p.headSnapshotId,
  };
  await insert(tx, p, book, knowledgeHash, 'ACTIVE');
  return book;
}
function directions(plan: PlanPayload) {
  if (plan.level !== 'VOLUME') return;
  let start = plan.chapterRange[0];
  for (const [i, d] of plan.arcDirections.entries()) {
    requireThat(
      d.order === i + 1 &&
        d.chapterRange[0] === start &&
        d.chapterRange[1] >= start &&
        d.chapterRange[1] - start < 10,
      'INVALID_PLAN',
      '剧情单元方向必须连续且每段不超过10章',
    );
    start = d.chapterRange[1] + 1;
  }
  requireThat(start === plan.chapterRange[1] + 1, 'INVALID_PLAN', '剧情单元方向未覆盖卷范围');
}
async function validatePlan(
  tx: DB | Tx,
  p: Project,
  plan: PlanPayload,
  activate: boolean,
  group: PlanPayload[] = [],
) {
  requireThat(p.headSnapshotId, 'NOT_READY', '请先确认开书');
  const base = await loadSnapshot(tx as DB, p.headSnapshotId, p.id);
  requireThat(
    plan.basedOnSnapshotId && base.ancestorIds.includes(plan.basedOnSnapshotId),
    'STALE_INPUT',
    '计划不属于当前事实链',
    409,
  );
  requireThat(
    plan.chapterRange[1] <= p.targetCount && plan.chapterRange[0] <= plan.chapterRange[1],
    'INVALID_PLAN',
    '计划范围超出目标',
  );
  validateConstraints(plan);
  directions(plan);
  const parents: PlanPayload[] = [];
  let child = plan;
  while (child.parentVersionId) {
    const bundled = group.find((g) => g.id === child.parentVersionId);
    const row = bundled
      ? null
      : await tx.planVersion.findUnique({ where: { id: child.parentVersionId } });
    requireThat(
      bundled ||
        (row &&
          row.projectId === p.id &&
          row.status === 'ACTIVE' &&
          row.chainEpoch === p.chainEpoch),
      'STALE_INPUT',
      '父计划已失效，请选择当前父版本',
      409,
    );
    const parent = bundled || readPlan(row!);
    requireThat(
      ['BOOK', 'VOLUME', 'ARC', 'CHAPTER'].indexOf(parent.level) + 1 ===
        ['BOOK', 'VOLUME', 'ARC', 'CHAPTER'].indexOf(child.level) &&
        child.chapterRange[0] >= parent.chapterRange[0] &&
        child.chapterRange[1] <= parent.chapterRange[1],
      'INVALID_PLAN',
      '父子计划层级或范围不匹配',
    );
    const ranges =
      parent.level === 'BOOK'
        ? parent.volumeDirections
        : parent.level === 'VOLUME'
          ? parent.arcDirections
          : null;
    if (ranges)
      requireThat(
        ranges.some(
          (d) =>
            d.chapterRange[0] === child.chapterRange[0] &&
            d.chapterRange[1] === child.chapterRange[1],
        ),
        'INVALID_PLAN',
        '计划范围必须与父级方向一致；先修订父级方向再调整下级',
      );
    parents.push(parent);
    child = parent;
  }
  requireThat(child.level === 'BOOK', 'INVALID_PLAN', '计划必须依赖全书版本');
  if (plan.level === 'BOOK') validateBook({ book: plan } as Opening, p.targetCount);
  if (plan.level === 'CHAPTER') {
    requireThat(
      plan.chapterRange[0] === plan.chapterRange[1] && plan.chapterRange[0] > p.headChapter,
      'COMPLETED_PLAN',
      '已提交章节的计划不可编辑，请先重写',
      409,
    );
    requireThat(
      plan.targetLength === p.targetLength &&
        plan.castIds.every((id) => !!base.state.characters[id]) &&
        plan.locationIds.every((id) => !!base.state.locations[id]),
      'INVALID_PLAN',
      '计划角色、地点或目标字数无效',
    );
    requireThat(
      plan.promiseActions.every((a) => !!base.state.promises[a.promiseId]),
      'INVALID_PLAN',
      '计划引用未知期待',
    );
  }
  for (let n = Math.max(p.headChapter + 1, plan.chapterRange[0]); n <= plan.chapterRange[1]; n++)
    effectiveHardConstraints([...parents, plan], n);
  for (const layer of [plan, ...parents]) {
    const checks = assumptionChecks(layer, base.state, base.versions);
    requireThat(
      layer.assumptions.every(
        (a) => a.basedOnSnapshotId && base.ancestorIds.includes(a.basedOnSnapshotId),
      ),
      'STALE_INPUT',
      '计划前提必须绑定当前链快照',
      409,
    );
    if (activate)
      requireThat(
        checks.every((c) => c.result === 'MATCH'),
        'PLAN_REVIEW_REQUIRED',
        '计划或父计划前提不成立，请修订',
      );
  }
}
export async function savePlanCandidates(
  db: DB,
  projectId: string,
  revision: number,
  payloads: PlanPayload[],
  options: { siblings?: boolean } = {},
) {
  requireThat(payloads.length > 0 && payloads.length <= 3000, 'INVALID_PLAN', '计划列表为空或过大');
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    requireThat(p.revision === revision, 'REVISION_CONFLICT', '小说已改变，请刷新', 409);
    requireThat(
      !(await tx.activeCommand.findUnique({ where: { projectId } })),
      'PROJECT_BUSY',
      '请先停止活动任务',
      409,
    );
    const knowledge = await resolveKnowledge(tx, projectId),
      versions: PlanVersion[] = [],
      groupId = options.siblings ? uuid() : undefined;
    if (options.siblings) {
      const ordered = [...payloads].sort((a, b) => a.chapterRange[0] - b.chapterRange[0]);
      const parent = await tx.planVersion.findUnique({
        where: { id: ordered[0].parentVersionId || '' },
      });
      requireThat(
        parent && parent.projectId === projectId && parent.rangeStart > p.headChapter,
        'INVALID_PLAN',
        '同层范围调整需覆盖尚未开始的完整父计划',
      );
      let next = parent.rangeStart;
      for (const v of ordered) {
        requireThat(
          v.parentVersionId === parent.id &&
            v.level === ordered[0].level &&
            v.chapterRange[0] === next,
          'INVALID_PLAN',
          '同层计划必须连续且无重叠',
        );
        next = v.chapterRange[1] + 1;
      }
      requireThat(next === parent.rangeEnd + 1, 'INVALID_PLAN', '同层范围须完整覆盖父计划');
    }
    for (const raw of payloads) {
      const parsed = planPayloadSchema.parse(raw);
      const previous = await tx.planVersion.findUnique({ where: { id: parsed.id } });
      requireThat(
        !previous || (previous.projectId === projectId && previous.level === parsed.level),
        'INVALID_PLAN',
        '计划来源不属于本项目',
      );
      if (previous && parsed.level !== 'BOOK' && previous.rangeStart <= p.headChapter)
        requireThat(
          previous.rangeStart === parsed.chapterRange[0] &&
            previous.rangeEnd === parsed.chapterRange[1],
          'COMPLETED_PLAN',
          '包含已完成章节的父计划不能改范围',
        );
      if (!options.siblings && previous)
        requireThat(
          previous.rangeStart === parsed.chapterRange[0] &&
            previous.rangeEnd === parsed.chapterRange[1],
          'INVALID_PLAN',
          '范围调整须提交同层完整列表',
        );
      const plan = {
        ...parsed,
        id: uuid(),
        basedOnSnapshotId: p.headSnapshotId,
        knowledgeVersionIds: knowledge.items.map((i) => i.versionId),
        assumptions: parsed.assumptions.map((a) => ({ ...a, basedOnSnapshotId: p.headSnapshotId })),
      };
      await validatePlan(tx, p, plan, false);
      versions.push(
        await insert(tx, p, plan, knowledge.hash, 'CANDIDATE', {
          groupId,
          ...(previous ? { supersedesVersionId: previous.id } : {}),
        }),
      );
    }
    await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
    return { versions, revision: p.revision + 1 };
  });
}
export async function getActivationCandidates(db: DB | Tx, projectId: string, versionId: string) {
  const row = await db.planVersion.findUnique({ where: { id: versionId } });
  requireThat(
    row && row.projectId === projectId && row.status === 'CANDIDATE',
    'INVALID_PLAN',
    '找不到待确认计划',
  );
  return row.groupId
    ? db.planVersion.findMany({ where: { projectId, groupId: row.groupId, status: 'CANDIDATE' } })
    : [row];
}
async function supersede(tx: Tx, p: Project, plan: PlanPayload) {
  const overlap = await tx.planVersion.findMany({
    where: {
      projectId: p.id,
      level: plan.level,
      status: { in: ['ACTIVE', 'NEEDS_REVIEW', 'STALE'] },
      rangeStart: { lte: plan.chapterRange[1] },
      rangeEnd: { gte: plan.chapterRange[0] },
    },
  });
  let ids = overlap.map((r) => r.id);
  if (ids.length)
    await tx.planVersion.updateMany({ where: { id: { in: ids } }, data: { status: 'SUPERSEDED' } });
  while (ids.length) {
    const children = await tx.planVersion.findMany({
      where: {
        projectId: p.id,
        parentVersionId: { in: ids },
        rangeEnd: { gt: p.headChapter },
        status: { in: ['ACTIVE', 'NEEDS_REVIEW'] },
      },
    });
    ids = children.map((r) => r.id);
    if (ids.length)
      await tx.planVersion.updateMany({ where: { id: { in: ids } }, data: { status: 'STALE' } });
  }
}
export async function activatePlanVersions(
  tx: Tx,
  projectId: string,
  versionIds: string[],
  validationId: string,
  jobId: string,
) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
  requireThat(
    (await tx.activeCommand.findUnique({ where: { projectId } }))?.jobId === jobId &&
      !job.cancelRequested &&
      job.status === 'RUNNING' &&
      (job.input as { planRevision: number }).planRevision === p.planRevision &&
      job.baseSnapshotId === p.headSnapshotId,
    'STALE_INPUT',
    '计划启用任务已失效',
    409,
  );
  const knowledge = await resolveKnowledge(tx, projectId),
    rows: PlanVersion[] = [];
  for (const id of versionIds) {
    const row = await tx.planVersion.findUniqueOrThrow({ where: { id } });
    requireThat(
      row.projectId === projectId &&
        row.status === 'CANDIDATE' &&
        row.chainEpoch === p.chainEpoch &&
        row.knowledgeHash === knowledge.hash,
      'STALE_INPUT',
      '候选依赖已改变，请保存新版本',
      409,
    );
    await validatePlan(tx, p, readPlan(row), true);
    rows.push(row);
  }
  for (const row of rows) await supersede(tx, p, readPlan(row));
  await tx.planVersion.updateMany({
    where: { id: { in: versionIds } },
    data: { status: 'ACTIVE', validationId },
  });
  await tx.project.update({
    where: { id: projectId },
    data: { revision: { increment: 1 }, planRevision: { increment: 1 } },
  });
  return rows;
}
export async function activePlanLayers(
  db: DB | Tx,
  p: Project,
  book: Opening['book'],
  n: number,
  ancestors: string[],
  knowledgeHash: string,
) {
  const base = await loadSnapshot(db as DB, p.headSnapshotId!, p.id);
  const rows = await db.planVersion.findMany({
    where: {
      projectId: p.id,
      status: 'ACTIVE',
      chainEpoch: p.chainEpoch,
      knowledgeHash,
      baseSnapshotId: { in: ancestors },
    },
  });
  const usable = async (row?: PlanVersion) => {
    if (!row) return undefined;
    const plan = readPlan(row),
      checks = assumptionChecks(plan, base.state, base.versions);
    if (checks.some((c) => c.result !== 'MATCH')) {
      await db.planVersion.update({
        where: { id: row.id },
        data: {
          status: checks.some((c) => c.importance === 'HARD' && c.result !== 'MATCH')
            ? 'STALE'
            : 'NEEDS_REVIEW',
        },
      });
      return undefined;
    }
    return plan;
  };
  const volume = (await usable(
    rows.find(
      (r) =>
        r.level === 'VOLUME' &&
        r.parentVersionId === book.id &&
        r.rangeStart <= n &&
        r.rangeEnd >= n,
    ),
  )) as Rolling['volume'] | undefined;
  const arc = volume
    ? ((await usable(
        rows.find(
          (r) =>
            r.level === 'ARC' &&
            r.parentVersionId === volume.id &&
            r.rangeStart <= n &&
            r.rangeEnd >= n,
        ),
      )) as Rolling['arc'] | undefined)
    : undefined;
  const chapters: ChapterPlan[] = [];
  if (arc)
    for (const row of rows
      .filter((r) => r.level === 'CHAPTER' && r.parentVersionId === arc.id && r.rangeStart >= n)
      .sort((a, b) => a.rangeStart - b.rangeStart)) {
      const plan = await usable(row);
      if (plan) chapters.push(plan as ChapterPlan);
    }
  return { volume, arc, chapters };
}
export async function registerRolling(
  tx: Tx,
  projectId: string,
  plans: Rolling,
  validationId: string,
  jobId: string,
) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
  requireThat(
    (await tx.activeCommand.findUnique({ where: { projectId } }))?.jobId ===
      (job.parentId || jobId) && !job.cancelRequested,
    'STALE_INPUT',
    '规划任务已失效',
    409,
  );
  const knowledge = await resolveKnowledge(tx, projectId);
  const group = [plans.volume, plans.arc, ...plans.chapters];
  for (const plan of group) {
    const existing = await tx.planVersion.findUnique({ where: { id: plan.id } });
    if (existing) {
      requireThat(
        existing.hash === hash(plan) && existing.status === 'ACTIVE',
        'STALE_INPUT',
        '不能覆盖既有计划版本',
      );
      continue;
    }
    await validatePlan(tx, p, plan, true, group);
    await supersede(tx, p, plan);
    await insert(tx, p, plan, knowledge.hash, 'ACTIVE', { validationId });
  }
  return plans;
}
