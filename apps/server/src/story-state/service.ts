import {
  collections,
  stateSchema,
  extractionSchema,
  type StoryState,
  type Extraction,
  type PropositionVersion,
  type Opening,
  type ChapterPlan,
} from '@one2novel/contracts';
import { canonical, requireThat } from '../platform/core.js';
type VersionMap = Record<string, PropositionVersion>;
export function emptyState(projectId: string, canonVersionId: string): StoryState {
  return {
    projectId,
    canonVersionId,
    chapterNo: 0,
    entities: {},
    characters: {},
    relationships: {},
    locations: {},
    items: {},
    organizations: {},
    worldRules: {},
    propositions: {},
    knowledge: [],
    timeline: {},
    promises: {},
    conflicts: {},
    goals: {},
    custom: {},
  };
}
export function checkSpan(
  span: { textVersionId: string; start: number; end: number; quote: string },
  versionId: string,
  body: string,
) {
  requireThat(
    span.textVersionId === versionId &&
      span.start >= 0 &&
      span.end > span.start &&
      span.end <= [...body].length &&
      [...body].slice(span.start, span.end).join('') === span.quote,
    'INVALID_EVIDENCE',
    '证据范围或引用文本不匹配',
  );
}
export function validateState(input: unknown, versions: VersionMap = {}): StoryState {
  const s = stateSchema.parse(input);
  const entity = (key: string | null, kind?: string) => {
    if (key !== null)
      requireThat(
        s.entities[key] && (!kind || s.entities[key].kind === kind),
        'STATE_REFERENCE',
        '实体引用或类型无效',
      );
  };
  const unique = (ids: string[]) =>
    requireThat(new Set(ids).size === ids.length, 'STATE_REFERENCE', '引用列表重复');
  for (const [key, v] of Object.entries(s.entities))
    requireThat(key === v.id, 'STATE_REFERENCE', '实体键与身份不一致');
  for (const [key, v] of Object.entries(s.characters)) {
    entity(key, 'CHARACTER');
    entity(v.locationId, 'LOCATION');
    unique(v.abilityIds);
    unique(v.organizationIds);
    v.abilityIds.forEach((x) => entity(x, 'ABILITY'));
    v.organizationIds.forEach((x) => {
      entity(x, 'ORGANIZATION');
      requireThat(
        s.organizations[x]?.memberIds.includes(key),
        'MEMBERSHIP_MISMATCH',
        '组织成员必须双向一致',
      );
    });
  }
  for (const [key, v] of Object.entries(s.locations)) {
    entity(key, 'LOCATION');
    entity(v.parentLocationId, 'LOCATION');
  }
  for (const [key, v] of Object.entries(s.items)) {
    entity(key, 'ITEM');
    entity(v.holderId);
    entity(v.locationId, 'LOCATION');
    requireThat(!(v.holderId && v.locationId), 'INVALID_HOLDER', '物品不能同时有持有者和地点');
  }
  for (const [key, v] of Object.entries(s.organizations)) {
    entity(key, 'ORGANIZATION');
    entity(v.leaderId, 'CHARACTER');
    unique(v.memberIds);
    v.memberIds.forEach((x) => {
      entity(x, 'CHARACTER');
      requireThat(
        s.characters[x]?.organizationIds.includes(key),
        'MEMBERSHIP_MISMATCH',
        '组织成员必须双向一致',
      );
    });
    if (v.leaderId)
      requireThat(v.memberIds.includes(v.leaderId), 'MEMBERSHIP_MISMATCH', '组织首领必须是成员');
  }
  for (const v of Object.values(s.relationships)) {
    entity(v.fromId);
    entity(v.toId);
    requireThat(v.fromId !== v.toId, 'STATE_REFERENCE', '关系主体不能相同');
  }
  for (const v of Object.values(s.worldRules)) v.scopeEntityIds.forEach((x) => entity(x));
  for (const [key, v] of Object.entries(s.propositions)) {
    requireThat(key === v.id, 'STATE_REFERENCE', '命题身份不匹配');
    entity(v.subjectId);
    if (v.currentVersionId) {
      const p = versions[v.currentVersionId];
      requireThat(
        p && p.propositionId === key && p.truth !== 'UNVERIFIED' && p.changeKind !== 'CLAIM',
        'PROPOSITION_INVALID',
        '客观命题指针必须引用同命题的客观版本',
      );
    }
  }
  unique(s.knowledge.map((k) => `${k.characterId}:${k.propositionId}`));
  for (const k of s.knowledge) {
    entity(k.characterId, 'CHARACTER');
    const p = versions[k.propositionVersionId];
    requireThat(
      s.propositions[k.propositionId] && p?.propositionId === k.propositionId,
      'KNOWLEDGE_INVALID',
      '角色知识引用无效',
    );
    if (k.attitude === 'KNOWS')
      requireThat(
        p.truth === 'TRUE' &&
          k.evidence.some((e) => ['EXPLICIT_NARRATION', 'OBSERVED_ACTION'].includes(e.assertion)),
        'KNOWLEDGE_INVALID',
        '确认获知必须有观察证据及对应时点真实命题',
      );
  }
  for (const [key, v] of Object.entries(s.promises)) {
    requireThat(key === v.id, 'STATE_REFERENCE', 'Promise身份不匹配');
    v.subjectIds.forEach((x) => entity(x));
    if (['RESOLVED', 'ABANDONED'].includes(v.status))
      requireThat(v.resolutionEventId, 'PROMISE_INVALID', '终结期待必须有事件');
  }
  for (const [key, v] of Object.entries(s.conflicts)) {
    requireThat(key === v.id, 'STATE_REFERENCE', '冲突身份不匹配');
    v.partyIds.forEach((x) => entity(x));
  }
  for (const [key, v] of Object.entries(s.goals)) {
    requireThat(key === v.id, 'STATE_REFERENCE', '目标身份不匹配');
    entity(v.ownerId);
  }
  requireThat(
    Object.keys(s.custom).length === 0,
    'UNSUPPORTED_STATE_FIELD',
    '首版没有注册自定义状态定义',
  );
  const acyclic = (keys: string[], edges: (key: string) => string[]) => {
    const done = new Set<string>(),
      visiting = new Set<string>();
    const visit = (k: string) => {
      requireThat(!visiting.has(k), 'STATE_CYCLE', '地点或时间线存在循环');
      if (done.has(k)) return;
      visiting.add(k);
      for (const v of edges(k)) {
        requireThat(keys.includes(v), 'STATE_REFERENCE', '图引用缺失');
        visit(v);
      }
      visiting.delete(k);
      done.add(k);
    };
    keys.forEach(visit);
  };
  acyclic(Object.keys(s.locations), (k) =>
    s.locations[k].parentLocationId ? [s.locations[k].parentLocationId!] : [],
  );
  const timelineEdges: Record<string, string[]> = {};
  for (const k of Object.keys(s.timeline)) timelineEdges[k] = [];
  for (const [key, v] of Object.entries(s.timeline)) {
    timelineEdges[key].push(...v.beforeIds);
    for (const prior of v.afterIds) {
      requireThat(timelineEdges[prior], 'STATE_REFERENCE', '时间线引用缺失');
      timelineEdges[prior].push(key);
    }
  }
  acyclic(Object.keys(s.timeline), (k) => timelineEdges[k]);
  return s;
}
export function validateOpening(opening: Opening, projectId: string) {
  requireThat(
    opening.state.projectId === projectId && opening.state.chapterNo === 0,
    'INVALID_CANON',
    '初始事实必须属于本项目 State 0',
  );
  const events = new Set(opening.initialEvents.map((e) => e.id));
  requireThat(events.size === opening.initialEvents.length, 'INVALID_CANON', '初始事件重复');
  opening.initialEvents.forEach((e) =>
    requireThat(
      e.canonVersionId === opening.state.canonVersionId,
      'INVALID_CANON',
      'Canon事件引用不一致',
    ),
  );
  const versions: VersionMap = {};
  for (const p of opening.propositionVersions) {
    requireThat(!versions[p.id] && p.changeKind === 'INITIAL', 'INVALID_CANON', '初始命题版本非法');
    versions[p.id] = p;
  }
  validateState(opening.state, versions);
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const o = v as Record<string, unknown>;
    if (o.kind === 'INITIAL')
      requireThat(events.has(String(o.id)), 'INVALID_CANON', '缺少初始事件');
    if (o.kind === 'CONTENT') requireThat(false, 'INVALID_CANON', '初始事实不能引用正文章');
    if ('origin' in o)
      requireThat(
        o.origin === 'CANON' && o.sourceVersionId === opening.state.canonVersionId,
        'INVALID_CANON',
        '初始事实来源必须是本次Canon',
      );
    Object.values(o).forEach(walk);
  };
  walk(opening.state);
  walk(opening.propositionVersions);
}
export function simulate(
  base: StoryState,
  baseId: string,
  raw: Extraction,
  body: string,
  contentId: string,
  existing: VersionMap = {},
  revivalAllowed = false,
): StoryState {
  const x = extractionSchema.parse(raw),
    d = x.delta;
  requireThat(
    d.baseSnapshotId === baseId && d.contentVersionId === contentId,
    'STALE_INPUT',
    'Delta基础或正文版本不匹配',
  );
  requireThat(
    new Set(x.events.map((e) => e.id)).size === x.events.length &&
      new Set(x.events.map((e) => e.order)).size === x.events.length,
    'INVALID_EVENT',
    '事件身份或顺序重复',
  );
  requireThat(
    canonical(d.eventIds) ===
      canonical([...x.events].sort((a, b) => a.order - b.order).map((e) => e.id)),
    'INVALID_EVENT',
    '事件索引必须按事件顺序完全覆盖',
  );
  requireThat(
    canonical(d.changes) ===
      canonical([...x.events].sort((a, b) => a.order - b.order).flatMap((e) => e.proposedChanges)),
    'INVALID_EVENT',
    '事件提案与Delta变更必须完全一致',
  );
  requireThat(
    canonical(d.propositionVersions) ===
      canonical([...x.events].sort((a, b) => a.order - b.order).flatMap((e) => e.assertions)),
    'INVALID_EVENT',
    '命题版本与事件断言不一致',
  );
  let s = structuredClone(base);
  const versions = { ...existing };
  const allowedEvents = new Set<string>();
  const historicalRefs = new Set<string>();
  const inspectRefs = (value: unknown, visit: (kind: string, id: string) => void) => {
    if (Array.isArray(value)) value.forEach((v) => inspectRefs(v, visit));
    else if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if ((o.kind === 'INITIAL' || o.kind === 'CONTENT') && typeof o.id === 'string')
        visit(o.kind, o.id);
      Object.values(o).forEach((v) => inspectRefs(v, visit));
    }
  };
  inspectRefs({ base, existing }, (kind, id) => historicalRefs.add(`${kind}:${id}`));
  const validateEventRefs = (value: unknown) =>
    inspectRefs(value, (kind, id) =>
      requireThat(
        historicalRefs.has(`${kind}:${id}`) || (kind === 'CONTENT' && allowedEvents.has(id)),
        'INVALID_EVENT_REFERENCE',
        '事实引用了未知或未来事件',
      ),
    );
  const walkEvidence = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walkEvidence);
      return;
    }
    const o = value as Record<string, unknown>;
    if ('origin' in o) {
      requireThat(
        o.origin === 'CONTENT' && o.sourceVersionId === contentId && o.span,
        'INVALID_EVIDENCE',
        '变更必须引用当前正文',
      );
      checkSpan(o.span as Parameters<typeof checkSpan>[0], contentId, body);
    }
    Object.values(o).forEach(walkEvidence);
  };
  for (const e of [...x.events].sort((a, b) => a.order - b.order)) {
    requireThat(e.contentVersionId === contentId, 'INVALID_EVENT', '事件正文引用不一致');
    allowedEvents.add(e.id);
    walkEvidence(e);
    for (const p of e.assertions) {
      requireThat(p.changeKind !== 'INITIAL', 'PROPOSITION_INVALID', '正文章不能新增初始命题版本');
      validateEventRefs(p);
      requireThat(
        !versions[p.id] &&
          p.recordedAtEventId.kind === 'CONTENT' &&
          p.recordedAtEventId.id === e.id,
        'PROPOSITION_INVALID',
        '命题版本必须追加到当前记录事件',
      );
      if (p.changeKind === 'CLAIM')
        requireThat(p.truth === 'UNVERIFIED', 'PROPOSITION_INVALID', '主张只能未证实');
      for (const predecessor of [p.supersedesVersionId, p.correctsVersionId])
        if (predecessor)
          requireThat(
            versions[predecessor]?.propositionId === p.propositionId,
            'PROPOSITION_INVALID',
            '命题历史必须位于当前祖先链',
          );
      versions[p.id] = p;
    }
    requireThat(
      new Set(e.proposedChanges.map((c) => c.order)).size === e.proposedChanges.length,
      'INVALID_EVENT',
      '同事件变更序号重复',
    );
    for (const c of [...e.proposedChanges].sort((a, b) => a.order - b.order)) {
      requireThat(c.eventId === e.id, 'INVALID_EVENT', '变更必须属于当前事件');
      if (!['knowledge', 'propositions'].includes(c.collection))
        requireThat(
          e.evidence.some(
            (proof) =>
              proof.assertion === 'EXPLICIT_NARRATION' || proof.assertion === 'OBSERVED_ACTION',
          ),
          'UNVERIFIED_FACT',
          '对白或推断不能单独建立客观状态变更',
        );
      requireThat(c.collection !== 'custom', 'UNSUPPORTED_STATE_FIELD', '首版没有自定义状态定义');
      const map: Record<string, unknown> =
        c.collection === 'knowledge'
          ? Object.fromEntries(s.knowledge.map((k) => [`${k.characterId}:${k.propositionId}`, k]))
          : (s[c.collection] as Record<string, unknown>);
      const old = map[c.key] as Record<string, unknown> | undefined;
      if (c.operation === 'CREATE')
        requireThat(!old && c.expected === null, 'DELTA_PRECONDITION', 'CREATE目标已存在');
      else {
        requireThat(old && c.expected, 'DELTA_PRECONDITION', 'SET_FIELDS目标不存在');
        requireThat(
          canonical(Object.keys(c.values).sort()) === canonical(Object.keys(c.expected).sort()),
          'DELTA_PRECONDITION',
          '每个修改字段必须提供旧值',
        );
        for (const field of Object.keys(c.values)) {
          requireThat(!['id', 'kind'].includes(field), 'IMMUTABLE_FIELD', '身份字段不可修改');
          requireThat(
            field in old && canonical(old[field]) === canonical(c.expected[field]),
            'DELTA_PRECONDITION',
            '状态旧值不匹配',
          );
        }
        if (c.collection === 'entities')
          requireThat(!('name' in c.values), 'IMMUTABLE_FIELD', '名称更改应通过别名表达');
        if (c.collection === 'propositions')
          requireThat(
            Object.keys(c.values).every((k) => k === 'currentVersionId'),
            'IMMUTABLE_FIELD',
            '命题语义不可修改',
          );
        if (c.collection === 'worldRules' && old.mutable === false)
          requireThat(false, 'IMMUTABLE_RULE', '不可修改固定世界规则');
      }
      const next = collections[c.collection].parse({ ...old, ...c.values }) as Record<
        string,
        unknown
      >;
      validateEventRefs(c.values);
      if (old) {
        if (c.collection === 'characters' && old.life !== 'UNKNOWN')
          requireThat(next.life !== 'UNKNOWN', 'INVALID_TRANSITION', '已确认生命状态不可退回未知');
        if (c.collection === 'promises' && old.status === 'ADVANCED')
          requireThat(next.status !== 'OPEN', 'INVALID_TRANSITION', '已推进期待不能退回初始状态');
        if (c.collection === 'organizations' && old.status === 'ACTIVE')
          requireThat(next.status !== 'UNKNOWN', 'INVALID_TRANSITION', '已成立组织不能退回未知');
        if (c.collection === 'characters' && old.life === 'DEAD' && next.life === 'ALIVE')
          requireThat(
            revivalAllowed && Object.values(s.worldRules).some((r) => r.active),
            'ILLEGAL_REVIVAL',
            '复活须有世界许可和独立验证',
          );
        const terminal: Partial<Record<keyof typeof collections, string[]>> = {
          promises: ['RESOLVED', 'ABANDONED'],
          goals: ['ACHIEVED', 'FAILED', 'ABANDONED'],
          conflicts: ['RESOLVED'],
          organizations: ['DISBANDED'],
        };
        if (terminal[c.collection]?.includes(String(old.status)))
          requireThat(old.status === next.status, 'INVALID_TRANSITION', '终态不可重新开启');
      }
      if (c.collection === 'knowledge') {
        const k = next as unknown as StoryState['knowledge'][number];
        requireThat(
          c.key === `${k.characterId}:${k.propositionId}` &&
            k.learnedAtEventId.kind === 'CONTENT' &&
            k.learnedAtEventId.id === e.id,
          'KNOWLEDGE_INVALID',
          '认知改变须有本次获知事件',
        );
        walkEvidence(k);
      }
      map[c.key] = next;
      if (c.collection === 'knowledge')
        s.knowledge = Object.entries(map)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, v]) => v) as StoryState['knowledge'];
    }
    for (const actor of e.actorIds)
      requireThat(s.entities[actor], 'STATE_REFERENCE', '事件主体不存在');
    // A whole event is the validation boundary, allowing atomic transfers with temporary crossed references.
    s = validateState(s, versions);
  }
  s.chapterNo = base.chapterNo + 1;
  return s;
}
export function assumptionChecks(
  plan: Pick<ChapterPlan, 'assumptions'>,
  s: StoryState,
  versions: VersionMap,
) {
  return plan.assumptions.map((a) => {
    const { collection, key, field } = a.selector;
    let row: unknown =
      collection === 'knowledge'
        ? s.knowledge.find((k) => `${k.characterId}:${k.propositionId}` === key)
        : (s as unknown as Record<string, Record<string, unknown>>)[collection]?.[key];
    let actual = (row as Record<string, unknown> | undefined)?.[field];
    if (collection === 'propositions' && field === 'currentTruth')
      actual = versions[s.propositions[key]?.currentVersionId || '']?.truth;
    const known = actual !== undefined && actual !== null;
    let matches = false;
    if (a.operator === 'EXISTS') matches = known === a.expected;
    else if (known) {
      if (a.operator === 'EQUALS') matches = canonical(actual) === canonical(a.expected);
      if (a.operator === 'NOT_EQUALS') matches = canonical(actual) !== canonical(a.expected);
      if (a.operator === 'CONTAINS')
        matches = Array.isArray(actual)
          ? actual.some((x) => canonical(x) === canonical(a.expected))
          : typeof actual === 'string' &&
            typeof a.expected === 'string' &&
            actual.includes(a.expected);
    }
    return {
      assumptionId: a.id,
      importance: a.importance,
      result: !known && a.operator !== 'EXISTS' ? 'UNKNOWN' : matches ? 'MATCH' : 'MISMATCH',
      actual: actual ?? null,
    };
  });
}
