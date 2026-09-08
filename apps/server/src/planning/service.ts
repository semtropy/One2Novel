import type { ChapterPlan, Opening, PropositionVersion, StoryState } from '@one2novel/contracts';
import { canonical, requireThat } from '../platform/core.js';
type PlanLayer = {
  id: string;
  level: string;
  chapterRange: [number, number];
  parentVersionId: string | null;
  constraints: ChapterPlan['constraints'];
  goals: ChapterPlan['goals'];
};
export function validateBook(opening: Opening, count: number) {
  const b = opening.book;
  requireThat(
    b.chapterRange[0] === 1 && b.chapterRange[1] === count,
    'INVALID_PLAN',
    '全书范围必须覆盖目标章数',
  );
  let next = 1;
  for (const [i, d] of b.volumeDirections.entries()) {
    requireThat(
      d.order === i + 1 &&
        d.chapterRange[0] === next &&
        d.chapterRange[1] >= next &&
        d.chapterRange[1] - next < 30,
      'INVALID_PLAN',
      '卷方向必须连续且每卷不超过30章',
    );
    next = d.chapterRange[1] + 1;
  }
  requireThat(next === count + 1, 'INVALID_PLAN', '卷方向未完整覆盖全书');
}
export function validateConstraints(plan: PlanLayer) {
  requireThat(
    plan.chapterRange[0] <= plan.chapterRange[1],
    'INVALID_PLAN',
    '计划范围不能倒置',
  );
  for (const c of plan.constraints) {
    const v = c.value as Record<string, unknown>;
    requireThat(
      v && typeof v === 'object' && !Array.isArray(v),
      'INVALID_CONSTRAINT',
      '约束值必须为对象',
    );
    if (c.kind === 'TEXT_RULE')
      requireThat(
        ['BANNED_PHRASE', 'POV', 'LENGTH_RANGE'].includes(String(v.rule)),
        'INVALID_CONSTRAINT',
        '未知文字规则',
      );
    if (c.kind === 'STATE_EQUALS')
      requireThat(
        typeof v.collection === 'string' &&
          typeof v.key === 'string' &&
          typeof v.field === 'string' &&
          'equals' in v,
        'INVALID_CONSTRAINT',
        '状态约束字段缺失',
      );
    if (c.kind === 'STATE_EQUALS') {
      requireThat(
        c.targetId === v.key && c.field === v.field,
        'INVALID_CONSTRAINT',
        '状态约束定位元数据必须与值一致',
      );
    }
    if (c.kind === 'PRESERVE_FACT')
      requireThat(
        typeof v.propositionId === 'string' && ['TRUE', 'FALSE'].includes(String(v.truth)),
        'INVALID_CONSTRAINT',
        '保持事实约束字段缺失',
      );
    if (c.kind === 'PRESERVE_FACT')
      requireThat(
        c.targetId === v.propositionId && c.field === 'truth',
        'INVALID_CONSTRAINT',
        '保持事实约束定位元数据必须与值一致',
      );
    if (c.kind === 'MUST_EVENT' || c.kind === 'FORBID_EVENT')
      requireThat(
        typeof v.eventDescription === 'string' && Number.isInteger(v.atChapter),
        'INVALID_CONSTRAINT',
        '事件约束字段缺失',
      );
  }
}
function stateField(s: StoryState, collection: string, key: string, field: string) {
  const row =
    collection === 'knowledge'
      ? s.knowledge.find((k) => `${k.characterId}:${k.propositionId}` === key)
      : (s as unknown as Record<string, Record<string, unknown>>)[collection]?.[key];
  requireThat(row && Object.prototype.hasOwnProperty.call(row, field), 'STATE_CONSTRAINT', '状态约束目标不存在');
  return (row as Record<string, unknown>)[field];
}
export function deterministicStateConstraintIssues(
  base: StoryState,
  next: StoryState,
  versions: Record<string, PropositionVersion>,
  constraints: ChapterPlan['constraints'],
) {
  const issues: { constraintId: string; reason: string; actual: unknown }[] = [];
  for (const c of constraints) {
    const v = c.value as Record<string, unknown>;
    if (c.kind === 'STATE_EQUALS') {
      const actual = stateField(next, String(v.collection), String(v.key), String(v.field));
      if (canonical(actual) !== canonical(v.equals))
        issues.push({ constraintId: c.id, reason: '状态字段未满足硬等值约束', actual });
    }
    if (c.kind === 'PRESERVE_FACT') {
      const proposition = next.propositions[String(v.propositionId)];
      const actual = proposition?.currentVersionId
        ? versions[proposition.currentVersionId]?.truth
        : null;
      if (actual !== v.truth)
        issues.push({ constraintId: c.id, reason: '当前命题真值未保持', actual });
    }
  }
  for (const c of constraints.filter((c) => c.kind === 'PRESERVE_FACT')) {
    const v = c.value as Record<string, unknown>;
    const before = base.propositions[String(v.propositionId)]?.currentVersionId;
    requireThat(
      before && versions[before]?.truth === v.truth,
      'STATE_CONSTRAINT',
      '保持事实约束引用的基础命题不存在或真值不匹配',
    );
  }
  return issues;
}
function appliesInChapter(plan: PlanLayer, chapterNo: number) {
  return plan.chapterRange[0] <= chapterNo && plan.chapterRange[1] >= chapterNo;
}
export function effectiveHardConstraints(layers: PlanLayer[], chapterNo: number) {
  const constraints = layers
    .filter((p) => appliesInChapter(p, chapterNo))
    .flatMap((p) => p.constraints)
    .filter((c) => c.severity === 'HARD')
    .filter((c) => {
      const v = c.value as { atChapter?: unknown };
      return (
        c.kind === 'TEXT_RULE' ||
        c.kind === 'STATE_EQUALS' ||
        c.kind === 'PRESERVE_FACT' ||
        Number(v.atChapter) === chapterNo
      );
    });
  requireThat(
    new Set(constraints.map((c) => c.id)).size === constraints.length,
    'INVALID_CONSTRAINT',
    '有效硬约束ID不能重复',
  );
  let minLength = 0,
    maxLength = Number.POSITIVE_INFINITY;
  const stateEquals = new Map<string, unknown>();
  for (const c of constraints) {
    const v = c.value as Record<string, unknown>;
    if (c.kind === 'TEXT_RULE' && v.rule === 'LENGTH_RANGE' && Array.isArray(v.argument)) {
      minLength = Math.max(minLength, Number(v.argument[0]));
      maxLength = Math.min(maxLength, Number(v.argument[1]));
    }
    if (c.kind === 'STATE_EQUALS') {
      const key = `${v.collection}:${v.key}:${v.field}`;
      if (stateEquals.has(key))
        requireThat(
          JSON.stringify(stateEquals.get(key)) === JSON.stringify(v.equals),
          'INVALID_CONSTRAINT',
          '同一状态字段存在冲突硬约束',
        );
      stateEquals.set(key, v.equals);
    }
  }
  requireThat(minLength <= maxLength, 'INVALID_CONSTRAINT', '硬长度约束互相冲突');
  return constraints;
}
