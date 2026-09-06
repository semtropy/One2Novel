import type { StoryState, ChapterPlan, PropositionVersion } from '@one2novel/contracts';
import { requireThat, hash } from '../platform/core.js';
export function resolveStateContext(
  plan: ChapterPlan,
  state: StoryState,
  versions: Record<string, PropositionVersion>,
) {
  const required = new Set([...plan.castIds, ...plan.locationIds]);
  for (const a of plan.assumptions) {
    if (state.entities[a.selector.key]) required.add(a.selector.key);
    if (a.selector.collection === 'propositions' && state.propositions[a.selector.key])
      required.add(state.propositions[a.selector.key].subjectId);
  }
  for (const action of plan.promiseActions) {
    if (action.required) {
      const p = state.promises[action.promiseId];
      requireThat(p, 'STATE_CONTEXT_UNRESOLVED', '必需Promise不存在');
      p.subjectIds.forEach((id) => required.add(id));
    }
  }
  const query =
    plan.expectedEvents.join('\n') + '\n' + plan.beats.map((b) => b.description).join('\n');
  for (const entity of Object.values(state.entities))
    if ([entity.name, ...entity.aliases].some((n) => n && query.includes(n)))
      required.add(entity.id);
  for (const goal of Object.values(state.goals))
    if (goal.status === 'ACTIVE' && query.includes(goal.description)) required.add(goal.ownerId);
  for (const conflict of Object.values(state.conflicts))
    if (conflict.status !== 'RESOLVED' && conflict.partyIds.some((id) => required.has(id)))
      conflict.partyIds.forEach((id) => required.add(id));
  for (const id of [...required]) {
    const c = state.characters[id];
    if (c?.locationId) required.add(c.locationId);
    for (const [itemId, item] of Object.entries(state.items))
      if (item.holderId === id) required.add(itemId);
  }
  required.forEach((id) =>
    requireThat(state.entities[id], 'STATE_CONTEXT_UNRESOLVED', '必要实体不存在'),
  );
  // Small first-volume states remain exact. No required facts are dropped to satisfy an arbitrary entity cap.
  // The LLM boundary checks the complete serialized budget, failing explicitly when it cannot fit.
  const selected = {
    state,
    propositionVersions: Object.values(versions),
    requiredEntityIds: [...required].sort(),
  };
  return { ...selected, hash: hash(selected) };
}
