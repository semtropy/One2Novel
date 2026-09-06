import type { Opening, ChapterPlan } from '@one2novel/contracts';
import { requireThat } from '../platform/core.js';
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
export function validateConstraints(plan: ChapterPlan) {
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
    if (c.kind === 'MUST_EVENT' || c.kind === 'FORBID_EVENT')
      requireThat(
        typeof v.eventDescription === 'string' && Number.isInteger(v.atChapter),
        'INVALID_CONSTRAINT',
        '事件约束字段缺失',
      );
  }
}
