import {
  policySchema,
  type Policy,
  type EvaluatorResult,
  type Issue,
  type ChapterPlan,
} from '@one2novel/contracts';
import { bodyLength, requireThat, uuid } from '../platform/core.js';
import { checkSpan } from '../story-state/service.js';
export const evaluators = [
  ['chapter-quality', '章节质量', '推进、节拍与章末钩子'],
  ['continuity', '连续性', '与近期正文衔接、地点和行动连续'],
  [
    'core.hard-constraints',
    '计划与硬约束',
    '逐项检查硬要求、禁区、required目标/Promise，禁止将软期限视为义务',
  ],
  ['logic', '因果逻辑', '动机、因果和能力限制'],
  ['character-consistency', '人物一致性', '人物动机与对白、合理变化证据'],
  ['style', '文字风格', '清晰具体、视角一致、避免无效解释'],
  ['repetition', '重复检查', '重复信息与片段，不因同名判断抄袭'],
  [
    'core.state-consistency',
    '事实一致性',
    '当前世界与角色观察版本分开，禁止无来源获知与未经证明的客观变更',
  ],
].map(([id, title, instructions]) => ({
  id,
  title,
  instructions,
  version: '1',
  core: id.startsWith('core.'),
}));
export const defaultPolicy: Policy = {
  requiredEvaluatorIds: evaluators.map((e) => e.id),
  optionalEvaluatorIds: [],
  minPassScores: Object.fromEntries(evaluators.map((e) => [e.id, 3])),
};
export function validatePolicy(raw: unknown): Policy {
  const p = policySchema.parse(raw),
    ids = [...p.requiredEvaluatorIds, ...p.optionalEvaluatorIds];
  requireThat(new Set(ids).size === ids.length, 'INVALID_POLICY', '审核器不能重复或同时必需与可选');
  for (const id of ids)
    requireThat(
      evaluators.some((e) => e.id === id) && p.minPassScores[id] !== undefined,
      'INVALID_POLICY',
      '审核器未注册或缺少阈值',
    );
  for (const e of evaluators.filter((e) => e.core))
    requireThat(
      p.requiredEvaluatorIds.includes(e.id) && p.minPassScores[e.id] === 3,
      'CORE_REQUIRED',
      '核心审核不可关闭或放宽',
    );
  return p;
}
export function validateResults(
  results: EvaluatorResult[],
  ids: string[],
  body: string,
  contentId: string,
  policy: Policy,
) {
  requireThat(
    results.length === ids.length &&
      new Set(results.map((r) => r.evaluatorId)).size === ids.length &&
      results.every((r) => ids.includes(r.evaluatorId)),
    'EVALUATOR_ERROR',
    '审核结果缺失、重复或含未知审核器',
  );
  for (const r of results) {
    requireThat(
      r.evaluatorVersion === '1' &&
        r.executionStatus === 'SUCCEEDED' &&
        r.score !== null &&
        !r.errorCode,
      'EVALUATOR_ERROR',
      '必需审核执行失败',
    );
    for (const issue of r.issues) {
      requireThat(issue.evaluatorId === r.evaluatorId, 'EVALUATOR_ERROR', '问题归属错误');
      issue.spans.forEach((s) => checkSpan(s, contentId, body));
      requireThat(
        issue.spans.length > 0 || issue.relatedRefs.length > 0 || issue.ruleId.length > 0,
        'EVALUATOR_ERROR',
        '问题缺少定位依据',
      );
    }
    if (r.score < policy.minPassScores[r.evaluatorId])
      requireThat(
        r.issues.some((i) => i.severity !== 'INFO'),
        'EVALUATOR_ERROR',
        '低分必须给出具体问题',
      );
  }
}
export function deterministicIssues(
  body: string,
  contentId: string,
  plan: ChapterPlan,
  recent: (string | { text: string; textVersionId: string })[],
  bannedPhrases: string[] = [],
  constraints: ChapterPlan['constraints'] = plan.constraints,
): Issue[] {
  const issues: Issue[] = [];
  const add = (ruleId: string, message: string) =>
    issues.push({
      id: uuid(),
      evaluatorId: 'core.hard-constraints',
      severity: 'BLOCKER',
      ruleId,
      message,
      spans: [],
      relatedRefs: [{ kind: 'ChapterPlan', id: plan.id, versionId: plan.id }],
      suggestion: '修改正文以满足该要求',
    });
  const length = bodyLength(body);
  bannedPhrases.forEach((phrase, i) => {
    if (body.includes(phrase)) add(`knowledge:banned:${i}`, `出现风格禁用词：${phrase}`);
  });
  if (length < plan.targetLength * 0.8 || length > plan.targetLength * 1.2)
    add(
      'length',
      `正文 ${length} 字，应为 ${Math.ceil(plan.targetLength * 0.8)}～${Math.floor(plan.targetLength * 1.2)} 字`,
    );
  for (const c of constraints.filter((c) => c.severity === 'HARD' && c.kind === 'TEXT_RULE')) {
    const v = c.value as { rule: string; argument: unknown };
    if (v.rule === 'BANNED_PHRASE' && typeof v.argument === 'string' && body.includes(v.argument))
      add(c.id, `出现禁用词：${v.argument}`);
    if (
      v.rule === 'LENGTH_RANGE' &&
      Array.isArray(v.argument) &&
      (length < Number(v.argument[0]) || length > Number(v.argument[1]))
    )
      add(c.id, '不符合显式长度约束');
  }
  const sentences = body.split(/[。！？!?\n]/u).map((s) => s.replace(/[\p{P}\s]/gu, '')),
    counts = new Map<string, number>();
  for (const s of sentences)
    if ([...s].length >= 20) {
      const n = (counts.get(s) || 0) + 1;
      counts.set(s, n);
      if (n === 3) add('repeated-sentence', '相同长句重复出现三次');
    }
  const chars = [...body];
  outer: for (const prior of recent) {
    const priorText = typeof prior === 'string' ? prior : prior.text;
    for (let i = 0; i + 80 <= chars.length; i++) {
      const fragment = chars.slice(i, i + 80).join('');
      const normalizedFragment = fragment.trim();
      const authorized = plan.allowedQuotes.some(
        (q) => q.text.includes(fragment) || q.text.includes(normalizedFragment),
      );
      const priorStart = priorText.indexOf(fragment);
      if (priorStart >= 0 && !authorized) {
        issues.push({
          id: uuid(),
          evaluatorId: 'core.hard-constraints',
          severity: 'BLOCKER',
          ruleId: 'repeated-passage',
          message:
            'Repeated passage overlaps existing prose or a reference source by at least 80 characters',
          spans: [
            { textVersionId: contentId, start: i, end: i + 80, quote: fragment },
            {
              textVersionId: typeof prior === 'string' ? contentId : prior.textVersionId,
              start: priorStart,
              end: priorStart + 80,
              quote: fragment,
            },
          ],
          relatedRefs: [{ kind: 'ChapterPlan', id: plan.id, versionId: plan.id }],
          suggestion: 'Revise the prose, or authorize this quote from the referenced source',
        });
        break outer;
      }
    }
  }
  return issues;
}
export function gate(results: EvaluatorResult[], policy: Policy) {
  return policy.requiredEvaluatorIds.every((id) => {
    const r = results.find((r) => r.evaluatorId === id);
    return (
      r?.executionStatus === 'SUCCEEDED' &&
      r.score !== null &&
      r.score >= policy.minPassScores[id] &&
      !r.issues.some((i) => i.severity !== 'INFO')
    );
  })
    ? 'PASS'
    : 'FAIL';
}
