import type { ModelGateway, ModelRequest } from '../../apps/server/src/platform/llm.js';
import { emptyState } from '../../apps/server/src/story-state/service.js';
import { uuid } from '../../apps/server/src/platform/core.js';
import { defaultPolicy } from '../../apps/server/src/evaluation/service.js';
import type { Opening, ChapterPlan, Extraction } from '@one2novel/contracts';
export class FakeModel implements ModelGateway {
  calls: { prompt: string; input: unknown }[] = [];
  failAt: string | null = null;
  minor = false;
  invalidState = false;
  delay = 0;
  beforeCall?: (request: ModelRequest<any>) => Promise<void>;
  ready() {
    return true;
  }
  async call<T>(r: ModelRequest<T>): Promise<T> {
    await r.reserve();
    this.calls.push({ prompt: r.prompt, input: r.input });
    await this.beforeCall?.(r);
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
    r.signal.throwIfAborted();
    if (r.prompt === this.failAt) throw new Error('Injected failure');
    const x = r.input as Record<string, any>;
    let result: unknown;
    const common = (level: string, range: [number, number], parent: string | null = null) => ({
      id: uuid(),
      level,
      parentVersionId: parent,
      chapterRange: range,
      title: '渡口来信',
      summary: '林舟调查来自渡口的信件。',
      basedOnSnapshotId: x.baseSnapshotId || null,
      knowledgeVersionIds: [],
      constraints: [],
      goals: [],
      assumptions: [],
    });
    if (r.prompt === 'planning.book') {
      const state = emptyState(x.projectId, x.canonId),
        characterId = uuid(),
        locationId = uuid();
      state.entities[characterId] = {
        id: characterId,
        kind: 'CHARACTER',
        name: '林舟',
        aliases: [],
        description: '在渡口修钟的年轻人。',
      };
      state.entities[locationId] = {
        id: locationId,
        kind: 'LOCATION',
        name: '渡口',
        aliases: [],
        description: '小镇东面的渡口。',
      };
      state.characters[characterId] = {
        life: 'ALIVE',
        locationId,
        conditions: [],
        abilityIds: [],
        organizationIds: [],
      };
      state.locations[locationId] = { parentLocationId: null, condition: '平静', accessible: true };
      const b = {
        ...common('BOOK', [1, x.project.targetCount]),
        level: 'BOOK' as const,
        premise: x.project.idea,
        centralQuestion: '谁寄来了这封信？',
        endingDirection: '找到失踪的钟匠',
        requiredFinalPromiseIds: [],
        volumeDirections: Array.from({ length: Math.ceil(x.project.targetCount / 30) }, (_, i) => ({
          order: i + 1,
          chapterRange: [i * 30 + 1, Math.min((i + 1) * 30, x.project.targetCount)] as [
            number,
            number,
          ],
          goal: '调查渡口来信',
        })),
      };
      result = {
        book: b,
        state,
        initialEvents: [
          { id: uuid(), canonVersionId: x.canonId, description: '林舟开篇前居住在渡口。' },
        ],
        propositionVersions: [],
        warnings: [],
      };
    } else if (r.prompt === 'planning.rolling') {
      const v = {
        ...common('VOLUME', [1, x.project.targetCount], x.book.id),
        entrySituation: '收到线索',
        exitGoal: '抵达钟楼',
        arcDirections: [
          { order: 1, chapterRange: [1, Math.min(10, x.project.targetCount)], goal: '调查来信' },
        ],
      };
      const start = Math.floor((x.requestedRange[0] - 1) / 10) * 10 + 1;
      const a = {
        ...common('ARC', [start, Math.min(start + 9, x.project.targetCount)], v.id),
        trigger: '收到来信',
        opposition: '信息缺失',
        turn: '找到刻字',
        resolutionTarget: '确认来源',
      };
      result = {
        volume: v,
        arc: a,
        chapters: Array.from({ length: x.requestedRange[1] - x.requestedRange[0] + 1 }, (_, i) => ({
          ...common('CHAPTER', [x.requestedRange[0] + i, x.requestedRange[0] + i], a.id),
          title: `第${x.requestedRange[0] + i}章 渡口来信`,
          castIds: Object.keys(x.state.characters),
          locationIds: Object.keys(x.state.locations),
          beats: [{ order: 1, function: '调查', description: '林舟查看来信', goalIds: [] }],
          expectedEvents: ['林舟检查钟表'],
          hook: { required: false, kind: null, question: null },
          promiseActions: [],
          targetLength: x.targetLength,
          allowedQuotes: [],
        })),
      };
    } else if (r.prompt === 'planning.validate') result = { violations: [], uncertain: [] };
    else if (r.prompt === 'production.write' || r.prompt === 'production.revise') {
      const c = x.plan || x.context.plan;
      const chars = Array.from({ length: c.targetLength }, (_, i) =>
        String.fromCodePoint(0x4e00 + ((c.chapterRange[0] * 521 + i) % 12000)),
      ).join('');
      result = `林舟检查了桌上的旧钟。\n\n${chars.slice(0, c.targetLength - 11)}`;
      await r.onText?.(result as string);
    } else if (r.prompt === 'evaluation.run')
      result = {
        results: x.requestedEvaluators.map((e: { id: string }) => ({
          evaluatorId: e.id,
          evaluatorVersion: '1',
          executionStatus: 'SUCCEEDED',
          score: this.minor && e.id === 'style' ? 2 : 4,
          issues:
            this.minor && e.id === 'style'
              ? [
                  {
                    id: uuid(),
                    evaluatorId: e.id,
                    severity: 'MINOR',
                    ruleId: 'style-detail',
                    message: '局部表达不清',
                    spans: [],
                    relatedRefs: [],
                    suggestion: '修正表达',
                  },
                ]
              : [],
          metrics: {},
          reason: '逐项检查通过',
          checkedConstraintIds: [],
          errorCode: null,
        })),
      };
    else if (r.prompt === 'state.extract' || r.prompt === 'state.repair') {
      const contentId = x.contentId,
        eventId = uuid(),
        characterId = Object.keys(x.state.characters)[0],
        old = x.state.characters[characterId].conditions;
      const change = {
        collection: 'characters' as const,
        key: characterId,
        operation: 'SET_FIELDS' as const,
        expected: { conditions: old },
        values: { conditions: this.invalidState ? 42 : [`已检查第${x.state.chapterNo + 1}章旧钟`] },
        eventId,
        order: 0,
      };
      const e = {
        id: eventId,
        contentVersionId: contentId,
        order: 0,
        kind: 'ACTION' as const,
        actorIds: [characterId],
        description: '林舟检查了旧钟',
        evidence: [
          {
            origin: 'CONTENT' as const,
            sourceVersionId: contentId,
            span: {
              textVersionId: contentId,
              start: 0,
              end: 11,
              quote: [...x.text].slice(0, 11).join(''),
            },
            assertion: 'OBSERVED_ACTION' as const,
            note: '检查动作',
          },
        ],
        assertions: [],
        proposedChanges: [change],
      };
      result = {
        events: [e],
        delta: {
          baseSnapshotId: x.baseSnapshotId,
          contentVersionId: contentId,
          eventIds: [eventId],
          changes: [change],
          propositionVersions: [],
          stateRuleVersion: '1',
        },
      };
    } else if (r.prompt === 'state.validate')
      result = {
        checks: x.extraction.delta.changes.map((_: unknown, i: number) => ({
          changeIndex: i,
          verdict: 'PASS',
          reason: '正文证据吻合',
          spans: [],
        })),
        missingChanges: [],
        noStateChange: false,
        revivalAuthorizations: [],
        reason: '全部检查通过',
      };
    else result = 'OK';
    return r.schema ? r.schema.parse(result) : (result as T);
  }
}
export const testSettings = {
  baseUrl: 'https://api.chatanywhere.tech/v1',
  profiles: [
    {
      id: 'test',
      name: 'Test fixture',
      model: 'fixture-only',
      contextWindow: 131072,
      maxOutput: 8192,
      outputTokenParam: 'max_tokens',
      supportsTemperature: false,
      structuredMode: 'TEXT_JSON',
      streaming: false,
    },
  ],
  roleMappings: {
    planner: 'test',
    writer: 'test',
    reviewer: 'test',
    extractor: 'test',
    repairer: 'test',
  },
};
