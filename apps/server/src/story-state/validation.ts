import { z } from 'zod';
import { stateValidationSchema, type Extraction, type StoryState } from '@one2novel/contracts';
import { hash, requireThat } from '../platform/core.js';
import { checkSpan } from './service.js';

// The model supplies only the verdict. The server binds it to the exact reviewed input.
export const savedValidationSchema = stateValidationSchema.extend({
  input: z
    .strictObject({
      baseSnapshotId: z.string().uuid(),
      contentVersionId: z.string().uuid(),
      extractionHash: z.string(),
      stateRuleVersion: z.string(),
    })
    .optional(),
});
export function validationInput(x: Extraction) {
  return {
    baseSnapshotId: x.delta.baseSnapshotId,
    contentVersionId: x.delta.contentVersionId,
    extractionHash: hash(x),
    stateRuleVersion: x.delta.stateRuleVersion,
  };
}
export function checkStateValidation(raw: unknown, x: Extraction, body: string, base?: StoryState) {
  const v = savedValidationSchema.parse(raw);
  requireThat(
    !v.input || hash(v.input) === hash(validationInput(x)),
    'STATE_VALIDATION_FAILED',
    '状态审核输入与当前提案不一致',
  );
  requireThat(
    v.checks.length === x.delta.changes.length &&
      new Set(v.checks.map((c) => c.changeIndex)).size === x.delta.changes.length &&
      v.checks.every((c) => c.changeIndex < x.delta.changes.length && c.verdict === 'PASS') &&
      !v.missingChanges.length &&
      (x.delta.changes.length > 0 || v.noStateChange),
    'STATE_VALIDATION_FAILED',
    '状态变化未通过独立验证',
  );
  for (const c of v.checks) c.spans.forEach((s) => checkSpan(s, x.delta.contentVersionId, body));
  const revivals = x.delta.changes.flatMap((c, i) =>
    c.collection === 'characters' && c.expected?.life === 'DEAD' && c.values.life === 'ALIVE'
      ? [i]
      : [],
  );
  requireThat(
    v.revivalAuthorizations.length === revivals.length &&
      new Set(v.revivalAuthorizations.map((p) => p.changeIndex)).size === revivals.length,
    'ILLEGAL_REVIVAL',
    '复活许可必须逐项对应实际复活变更',
  );
  for (const proof of v.revivalAuthorizations) {
    requireThat(
      revivals.includes(proof.changeIndex) && (!base || base.worldRules[proof.ruleId]?.active),
      'ILLEGAL_REVIVAL',
      '复活必须引用原基础状态中明确允许该行为的世界规则',
    );
    proof.spans.forEach((s) => checkSpan(s, x.delta.contentVersionId, body));
  }
  return v;
}
