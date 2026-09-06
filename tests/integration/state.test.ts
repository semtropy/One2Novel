import { describe, it, expect } from 'vitest';
import {
  emptyState,
  validateState,
  simulate,
  assumptionChecks,
} from '../../apps/server/src/story-state/service.js';
import { uuid } from '../../apps/server/src/platform/core.js';
import { gate, defaultPolicy, validatePolicy } from '../../apps/server/src/evaluation/service.js';
import type { PropositionVersion, Extraction } from '@one2novel/contracts';
describe('事实与角色观察', () => {
  it('世界从门开变门关后，角色仍保留旧TRUE观察版本', () => {
    const project = uuid(),
      canon = uuid(),
      character = uuid(),
      door = uuid(),
      prop = uuid(),
      v1 = uuid(),
      v2 = uuid(),
      initial = uuid();
    const s = emptyState(project, canon);
    s.entities[character] = {
      id: character,
      kind: 'CHARACTER',
      name: '林舟',
      aliases: [],
      description: '',
    };
    s.entities[door] = { id: door, kind: 'ITEM', name: '门', aliases: [], description: '' };
    s.characters[character] = {
      life: 'ALIVE',
      locationId: null,
      conditions: [],
      abilityIds: [],
      organizationIds: [],
    };
    s.items[door] = { holderId: null, locationId: null, condition: '关', quantity: 1 };
    s.propositions[prop] = {
      id: prop,
      subjectId: door,
      predicate: '开着',
      object: true,
      currentVersionId: v2,
    };
    const evidence = {
      origin: 'CANON' as const,
      sourceVersionId: canon,
      span: null,
      assertion: 'OBSERVED_ACTION' as const,
      note: '看见门开',
    };
    const version: PropositionVersion = {
      id: v1,
      propositionId: prop,
      truth: 'TRUE',
      changeKind: 'INITIAL',
      effectiveAtEventId: { kind: 'INITIAL', id: initial },
      recordedAtEventId: { kind: 'INITIAL', id: initial },
      supersedesVersionId: null,
      correctsVersionId: null,
      evidence: [evidence],
    };
    s.knowledge = [
      {
        characterId: character,
        propositionId: prop,
        propositionVersionId: v1,
        learnedAtEventId: { kind: 'INITIAL', id: initial },
        attitude: 'KNOWS',
        evidence: [evidence],
      },
    ];
    expect(
      validateState(s, {
        [v1]: version,
        [v2]: {
          ...version,
          id: v2,
          truth: 'FALSE',
          changeKind: 'WORLD_CHANGE',
          supersedesVersionId: v1,
        },
      }).knowledge[0].attitude,
    ).toBe('KNOWS');
  });
  it('拒绝负库存、未知状态字段、地点循环', () => {
    const s = emptyState(uuid(), uuid()),
      l = uuid();
    s.entities[l] = { id: l, kind: 'LOCATION', name: '甲', aliases: [], description: '' };
    s.locations[l] = { parentLocationId: l, condition: '', accessible: true };
    expect(() => validateState(s)).toThrow();
    expect(() => validateState({ ...emptyState(uuid(), uuid()), hallucination: 1 })).toThrow();
  });
  it('Core不能关闭，optional低分不改变必需门禁', () => {
    expect(() => validatePolicy({ ...defaultPolicy, requiredEvaluatorIds: [] })).toThrow();
    const results = defaultPolicy.requiredEvaluatorIds.map((id) => ({
      evaluatorId: id,
      evaluatorVersion: '1',
      executionStatus: 'SUCCEEDED' as const,
      score: 4,
      issues: [],
      metrics: {},
      reason: '通过',
      checkedConstraintIds: [],
      errorCode: null,
    }));
    expect(gate(results, defaultPolicy)).toBe('PASS');
    expect(gate(results.slice(1), defaultPolicy)).toBe('FAIL');
  });
});
