import type { Opening } from '@one2novel/contracts';
import { uuid } from '../platform/core.js';

// A replacement canon owns fresh event and proposition versions. Entity identities stay stable.
export function forkInitialOpening(source: Opening): Opening {
  const next = structuredClone(source);
  const canonId = uuid();
  const events = new Map(next.initialEvents.map((e) => [e.id, uuid()]));
  const versions = new Map(next.propositionVersions.map((v) => [v.id, uuid()]));
  function references(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.origin === 'CANON') row.sourceVersionId = canonId;
    if (row.kind === 'INITIAL' && typeof row.id === 'string') row.id = events.get(row.id) ?? row.id;
    for (const child of Object.values(row)) references(child);
  }
  references(next.state);
  references(next.propositionVersions);
  next.state.canonVersionId = canonId;
  for (const e of next.initialEvents) {
    e.id = events.get(e.id)!;
    e.canonVersionId = canonId;
  }
  for (const v of next.propositionVersions) v.id = versions.get(v.id)!;
  for (const p of Object.values(next.state.propositions))
    if (p.currentVersionId) p.currentVersionId = versions.get(p.currentVersionId)!;
  for (const k of next.state.knowledge)
    k.propositionVersionId = versions.get(k.propositionVersionId)!;
  next.book.basedOnSnapshotId = null;
  for (const a of next.book.assumptions) {
    a.basedOnSnapshotId = null;
    if (
      ['currentVersionId', 'propositionVersionId'].includes(a.selector.field) &&
      typeof a.expected === 'string'
    )
      a.expected = versions.get(a.expected) ?? a.expected;
    references(a.expected);
  }
  return next;
}
