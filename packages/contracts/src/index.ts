import { z } from 'zod';
export const text = z.string().refine((s) => !s.includes('\0'), '文本不能包含 NUL');
export const id = z.string().uuid();
export const json = z.json();
export const obj = z.record(z.string(), json);
export const refSchema = z.strictObject({ kind: z.enum(['INITIAL', 'CONTENT']), id });
export const spanSchema = z.strictObject({
  textVersionId: id,
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: text,
});
export const evidenceSchema = z.strictObject({
  origin: z.enum(['CANON', 'CONTENT']),
  sourceVersionId: id,
  span: spanSchema.nullable(),
  assertion: z.enum(['EXPLICIT_NARRATION', 'OBSERVED_ACTION', 'DIALOGUE', 'INFERENCE']),
  note: text,
});
export const entitySchema = z.strictObject({
  id,
  kind: z.enum(['CHARACTER', 'LOCATION', 'ITEM', 'ORGANIZATION', 'ABILITY', 'CONCEPT']),
  name: text.min(1),
  aliases: z.array(text),
  description: text,
});
export const propositionSchema = z.strictObject({
  id,
  subjectId: id,
  predicate: text,
  object: json,
  currentVersionId: id.nullable(),
});
export const propositionVersionSchema = z.strictObject({
  id,
  propositionId: id,
  truth: z.enum(['TRUE', 'FALSE', 'UNVERIFIED']),
  changeKind: z.enum(['INITIAL', 'WORLD_CHANGE', 'CORRECTION', 'CLAIM']),
  effectiveAtEventId: refSchema,
  recordedAtEventId: refSchema,
  supersedesVersionId: id.nullable(),
  correctsVersionId: id.nullable(),
  evidence: z.array(evidenceSchema).min(1),
});
export const knowledgeSchema = z.strictObject({
  characterId: id,
  propositionId: id,
  propositionVersionId: id,
  learnedAtEventId: refSchema,
  attitude: z.enum(['KNOWS', 'BELIEVES', 'SUSPECTS', 'REJECTS']),
  evidence: z.array(evidenceSchema).min(1),
});
export const constraintSchema = z.strictObject({
  id,
  severity: z.enum(['HARD', 'SOFT']),
  kind: z.enum(['MUST_EVENT', 'FORBID_EVENT', 'STATE_EQUALS', 'PRESERVE_FACT', 'TEXT_RULE']),
  targetId: id.nullable(),
  field: text.nullable(),
  value: json,
  description: text,
});
export const collections = {
  entities: entitySchema,
  characters: z.strictObject({
    life: z.enum(['ALIVE', 'DEAD', 'UNKNOWN']),
    locationId: id.nullable(),
    conditions: z.array(text),
    abilityIds: z.array(id),
    organizationIds: z.array(id),
  }),
  relationships: z.strictObject({
    fromId: id,
    toId: id,
    type: text,
    stance: z.enum(['ALLY', 'NEUTRAL', 'HOSTILE', 'UNKNOWN']),
    description: text,
  }),
  locations: z.strictObject({
    parentLocationId: id.nullable(),
    condition: text,
    accessible: z.boolean().nullable(),
  }),
  items: z.strictObject({
    holderId: id.nullable(),
    locationId: id.nullable(),
    condition: text,
    quantity: z.number().nonnegative().nullable(),
  }),
  organizations: z.strictObject({
    status: z.enum(['ACTIVE', 'DISBANDED', 'UNKNOWN']),
    leaderId: id.nullable(),
    memberIds: z.array(id),
  }),
  worldRules: z.strictObject({
    description: text,
    scopeEntityIds: z.array(id),
    constraint: constraintSchema.nullable(),
    mutable: z.boolean(),
    active: z.boolean(),
  }),
  propositions: propositionSchema,
  knowledge: knowledgeSchema,
  timeline: z.strictObject({
    eventId: refSchema,
    beforeIds: z.array(id),
    afterIds: z.array(id),
    exactTime: text.nullable(),
  }),
  promises: z.strictObject({
    id,
    kind: z.enum(['FORESHADOW', 'MYSTERY', 'SECRET', 'TASK', 'CONFLICT', 'EXPECTATION']),
    description: text,
    setupEventId: refSchema,
    subjectIds: z.array(id),
    status: z.enum(['OPEN', 'ADVANCED', 'RESOLVED', 'ABANDONED']),
    lastEventId: refSchema,
    resolutionCondition: text,
    resolutionEventId: refSchema.nullable(),
  }),
  conflicts: z.strictObject({
    id,
    partyIds: z.array(id).min(2),
    stake: text,
    status: z.enum(['ACTIVE', 'ESCALATED', 'RESOLVED']),
    eventId: refSchema,
  }),
  goals: z.strictObject({
    id,
    ownerId: id,
    description: text,
    successCondition: text,
    status: z.enum(['ACTIVE', 'ACHIEVED', 'FAILED', 'ABANDONED']),
    eventId: refSchema,
  }),
  custom: z.strictObject({
    id,
    definitionVersionId: id,
    ownerId: id.nullable(),
    value: json,
    evidence: z.array(evidenceSchema),
  }),
};
export const stateSchema = z.strictObject({
  projectId: id,
  chapterNo: z.number().int().nonnegative(),
  canonVersionId: id,
  entities: z.record(id, collections.entities),
  characters: z.record(id, collections.characters),
  relationships: z.record(id, collections.relationships),
  locations: z.record(id, collections.locations),
  items: z.record(id, collections.items),
  organizations: z.record(id, collections.organizations),
  worldRules: z.record(id, collections.worldRules),
  propositions: z.record(id, collections.propositions),
  knowledge: z.array(knowledgeSchema),
  timeline: z.record(id, collections.timeline),
  promises: z.record(id, collections.promises),
  conflicts: z.record(id, collections.conflicts),
  goals: z.record(id, collections.goals),
  custom: z.record(id, collections.custom),
});
export type StoryState = z.infer<typeof stateSchema>;
export type PropositionVersion = z.infer<typeof propositionVersionSchema>;
export const changeSchema = z.strictObject({
  collection: z.enum(
    Object.keys(collections) as [keyof typeof collections, ...(keyof typeof collections)[]],
  ),
  key: text,
  operation: z.enum(['CREATE', 'SET_FIELDS']),
  expected: obj.nullable(),
  values: obj,
  eventId: id,
  order: z.number().int().nonnegative(),
});
export const eventSchema = z.strictObject({
  id,
  contentVersionId: id,
  order: z.number().int().nonnegative(),
  kind: z.enum([
    'ACTION',
    'REVELATION',
    'STATE_CHANGE',
    'RELATION_CHANGE',
    'PROMISE_CHANGE',
    'GOAL_CHANGE',
  ]),
  actorIds: z.array(id),
  description: text,
  evidence: z.array(evidenceSchema).min(1),
  assertions: z.array(propositionVersionSchema),
  proposedChanges: z.array(changeSchema),
});
export const deltaSchema = z.strictObject({
  baseSnapshotId: id,
  contentVersionId: id,
  eventIds: z.array(id),
  changes: z.array(changeSchema),
  propositionVersions: z.array(propositionVersionSchema),
  stateRuleVersion: z.literal('1'),
});
export const extractionSchema = z.strictObject({
  events: z.array(eventSchema),
  delta: deltaSchema,
});
export type Extraction = z.infer<typeof extractionSchema>;
export const assumptionSchema = z.strictObject({
  id,
  selector: z.strictObject({ collection: text, key: text, field: text }),
  operator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'EXISTS']),
  expected: json,
  importance: z.enum(['HARD', 'SOFT']),
  reason: text,
  basedOnSnapshotId: id.nullable(),
});
export const goalSchema = z.strictObject({
  id,
  description: text,
  successEvidence: text,
  required: z.boolean(),
});
const commonPlan = {
  id,
  level: z.enum(['BOOK', 'VOLUME', 'ARC', 'CHAPTER']),
  parentVersionId: id.nullable(),
  chapterRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  title: text,
  summary: text,
  basedOnSnapshotId: id.nullable(),
  knowledgeVersionIds: z.array(id),
  constraints: z.array(constraintSchema),
  goals: z.array(goalSchema),
  assumptions: z.array(assumptionSchema),
};
const direction = z.strictObject({
  order: z.number().int().positive(),
  chapterRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  goal: text,
});
export const bookSchema = z.strictObject({
  ...commonPlan,
  level: z.literal('BOOK'),
  premise: text,
  centralQuestion: text,
  endingDirection: text,
  requiredFinalPromiseIds: z.array(id),
  volumeDirections: z.array(direction).min(1),
});
export const volumeSchema = z.strictObject({
  ...commonPlan,
  level: z.literal('VOLUME'),
  entrySituation: text,
  exitGoal: text,
  arcDirections: z.array(direction).min(1),
});
export const arcSchema = z.strictObject({
  ...commonPlan,
  level: z.literal('ARC'),
  trigger: text,
  opposition: text,
  turn: text,
  resolutionTarget: text,
});
export const chapterPlanSchema = z.strictObject({
  ...commonPlan,
  level: z.literal('CHAPTER'),
  castIds: z.array(id),
  locationIds: z.array(id),
  beats: z
    .array(
      z.strictObject({
        order: z.number().int(),
        function: text,
        description: text,
        goalIds: z.array(id),
      }),
    )
    .min(1),
  expectedEvents: z.array(text).min(1),
  hook: z.strictObject({ required: z.boolean(), kind: text.nullable(), question: text.nullable() }),
  promiseActions: z.array(
    z.strictObject({
      promiseId: id,
      action: z.enum(['ADVANCE', 'RESOLVE']),
      required: z.boolean(),
    }),
  ),
  targetLength: z.number().int().min(500).max(10000),
  allowedQuotes: z.array(
    z.strictObject({ text, sourceRef: z.strictObject({ kind: text, id, versionId: id }) }),
  ),
});
export const openingSchema = z.strictObject({
  book: bookSchema,
  state: stateSchema,
  initialEvents: z.array(z.strictObject({ id, canonVersionId: id, description: text })),
  propositionVersions: z.array(propositionVersionSchema),
  warnings: z.array(text),
});
export const rollingSchema = z.strictObject({
  volume: volumeSchema,
  arc: arcSchema,
  chapters: z.array(chapterPlanSchema).min(1).max(5),
});
export const planningValidationSchema = z.strictObject({
  violations: z.array(z.strictObject({ constraintId: text, reason: text, evidence: text })),
  uncertain: z.array(text),
});
export const stateValidationSchema = z.strictObject({
  checks: z.array(
    z.strictObject({
      changeIndex: z.number().int().nonnegative(),
      verdict: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
      reason: text,
      spans: z.array(spanSchema),
    }),
  ),
  missingChanges: z.array(text),
  noStateChange: z.boolean(),
  revivalAuthorizations: z.array(
    z.strictObject({
      changeIndex: z.number().int().nonnegative(),
      ruleId: id,
      spans: z.array(spanSchema).min(1),
    }),
  ),
  reason: text,
});
export const issueSchema = z.strictObject({
  id,
  evaluatorId: text,
  severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR', 'INFO']),
  ruleId: text,
  message: text,
  spans: z.array(spanSchema),
  relatedRefs: z.array(z.strictObject({ kind: text, id, versionId: id })),
  suggestion: text,
});
export const evaluatorResultSchema = z.strictObject({
  evaluatorId: text,
  evaluatorVersion: text,
  executionStatus: z.enum(['SUCCEEDED', 'ERROR']),
  score: z.number().int().min(0).max(4).nullable(),
  issues: z.array(issueSchema),
  metrics: z.record(text, z.number().nullable()),
  reason: text,
  checkedConstraintIds: z.array(text),
  errorCode: text.nullable(),
});
export const evaluationResponseSchema = z.strictObject({ results: z.array(evaluatorResultSchema) });
export const policySchema = z.strictObject({
  requiredEvaluatorIds: z.array(text),
  optionalEvaluatorIds: z.array(text),
  minPassScores: z.record(text, z.number().int().min(2).max(4)),
});
export type Policy = z.infer<typeof policySchema>;
export const skillSchema = z.strictObject({
  skillId: text,
  definitionVersion: z.literal('1'),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(100),
  config: z.strictObject({ strength: z.number().min(0).max(1) }),
  applicable: z.strictObject({
    genres: z.array(text),
    chapterFunctions: z.array(text),
    chapterRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
  }),
});
export const profileSchema = z.strictObject({
  id: text.min(1),
  name: text.min(1),
  model: text.min(1).max(100),
  contextWindow: z.number().int().min(8192).max(2000000),
  maxOutput: z.number().int().min(1024).max(128000),
  outputTokenParam: z.enum(['max_tokens', 'max_completion_tokens']),
  supportsTemperature: z.boolean(),
  structuredMode: z.enum(['JSON_SCHEMA', 'JSON_OBJECT', 'TEXT_JSON']),
  streaming: z.boolean(),
});
export const settingsSchema = z.strictObject({
  baseUrl: z.enum(['https://api.chatanywhere.tech/v1', 'https://api.chatanywhere.org/v1']),
  profiles: z.array(profileSchema).max(20),
  roleMappings: z.strictObject({
    planner: text,
    writer: text,
    reviewer: text,
    extractor: text,
    repairer: text,
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
export const projectInputSchema = z.strictObject({
  title: text.max(100).default('未命名小说'),
  idea: text.min(1).max(2000),
  genre: text.min(1).max(50),
  requirements: z.strictObject({
    must: z.array(text.max(500)).max(20),
    avoid: z.array(text.max(500)).max(20),
    preferences: z.array(text.max(500)).max(20),
  }),
  targetCount: z.number().int().min(1).max(3000),
  targetLength: z.number().int().min(500).max(10000),
});
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type EvaluatorResult = z.infer<typeof evaluatorResultSchema>;
export type Issue = z.infer<typeof issueSchema>;
export const stageLabels: Record<string, string> = {
  NEXT: '准备下一章',
  CHILD_RUNNING: '连续创作中',
  PAUSED: '已暂停',
  QUEUED: '等待执行',
  PLANNING: '规划章节',
  OPENING: '构思全书',
  CONTEXT_BUILDING: '整理上下文',
  WRITING: '撰写正文',
  EVALUATING: '审核正文',
  REVISING: '修订正文',
  EXTRACTING_STATE_DELTA: '提取故事事件',
  VALIDATING_STATE: '校验事实变更',
  COMMITTING: '提交章节',
  SUCCEEDED: '已完成',
  FAILED: '执行失败',
  INTERRUPTED: '运行中断',
  CANCELLED: '已取消',
};
export const writeRequestSchema = z
  .strictObject({
    expectedRevision: z.number().int().nonnegative(),
    mode: z.enum(['GENERATE', 'AUDIT_DRAFT']).default('GENERATE'),
    draftRevision: z.number().int().nonnegative().nullable().default(null),
    count: z.number().int().min(1).max(10).default(1),
  })
  .refine(
    (v) => v.mode !== 'AUDIT_DRAFT' || (v.count === 1 && v.draftRevision !== null),
    '审核工作草稿只能执行一章，并须提供草稿版本',
  );
