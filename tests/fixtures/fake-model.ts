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
  flipFirstPropositionTruth = false;
  delay = 0;
  forgedAllowedQuotes: ChapterPlan['allowedQuotes'] = [];
  bodyPrefix = '';
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
    if (r.prompt === 'reference.chapter') {
      const offset = x.primaryStart - x.inputStart,
        primary = [...x.text].slice(offset).join('');
      const position = primary.indexOf('陆砚'),
        entityId = x.candidates.find((e: any) => e.name === '陆砚')?.id || uuid();
      const quote = position >= 0 ? '陆砚' : [...primary].slice(0, 10).join('');
      const start = x.primaryStart + (position >= 0 ? [...primary.slice(0, position)].length : 0);
      const evidence = {
        textVersionId: x.textVersionId,
        start,
        end: start + [...quote].length,
        quote,
      };
      const eventId = uuid(),
        emotion = { valence: 0, arousal: 2, label: '好奇' };
      result = {
        summary: '陆砚沿旧地图寻找钟楼，线索引出新的疑问。',
        coverageNotes: '按测试样本完整覆盖本单元',
        entities:
          position >= 0
            ? [
                {
                  id: entityId,
                  kind: 'CHARACTER',
                  name: '陆砚',
                  aliases: [],
                  description: '寻找钟楼的旅人',
                  evidence: [evidence],
                },
              ]
            : [],
        scenes: [],
        events: [
          {
            id: eventId,
            actorIds: position >= 0 ? [entityId] : [],
            action: '调查旧地图',
            result: '发现新的线索',
            evidence,
            sceneId: null,
            sequence: 0,
          },
        ],
        beats: [
          {
            id: uuid(),
            eventIds: [eventId],
            function: 'REVEAL',
            summary: '线索带来新的疑问',
            intensity: 2,
            emotionBefore: emotion,
            emotionAfter: emotion,
            evidence: [evidence],
          },
        ],
        stateChanges: [],
        hooks: [],
        timeline: [],
        promises: [],
        unresolvedIdentities: [],
      };
    } else if (r.prompt === 'reference.aggregate') {
      result = {
        summary: '旅人逐步发现旧地图的秘密。',
        unitIds: x.children.flatMap((c: any) => c.unitIds),
      };
    } else if (r.prompt === 'knowledge.adapt') {
      const mapping = new Map<string, string>(x.source.assets.map((a: any) => [a.id, uuid()]));
      result = {
        stage: 'ADAPTED',
        sourceVersionId: x.sourceVersionId,
        adaptationBrief: x.adaptationBrief,
        assets: x.source.assets.map((a: any) => ({
          ...a,
          id: mapping.get(a.id),
          name: '星港' + a.name,
          description: '在星港寻找失踪信使的新人物',
          originAssetId: a.id,
          relationAssetIds: a.relationAssetIds.map((id: string) => mapping.get(id)),
        })),
        mapping: x.source.assets.map((a: any) => ({
          oldId: a.id,
          newId: mapping.get(a.id),
          changes: ['重设为星港背景与全新目标'],
        })),
      };
    } else if (r.prompt === 'planning.book') {
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
        arcDirections: Array.from({ length: Math.ceil(x.project.targetCount / 10) }, (_, i) => ({
          order: i + 1,
          chapterRange: [i * 10 + 1, Math.min(i * 10 + 10, x.project.targetCount)],
          goal: '调查来信',
        })),
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
          allowedQuotes: this.forgedAllowedQuotes,
        })),
      };
    } else if (r.prompt === 'planning.validate') result = { violations: [], uncertain: [] };
    else if (r.prompt === 'production.write' || r.prompt === 'production.revise') {
      const c = x.plan || x.context.plan;
      const chars = Array.from({ length: c.targetLength }, (_, i) =>
        String.fromCodePoint(0x4e00 + ((c.chapterRange[0] * 521 + i) % 12000)),
      ).join('');
      const prefix = this.bodyPrefix || '林舟检查了桌上的旧钟。';
      result = `${prefix}\n\n${chars.slice(0, Math.max(0, c.targetLength - [...prefix].length))}`;
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
          checkedConstraintIds: x.requiredConstraintIds || [],
          errorCode: null,
        })),
      };
    else if (r.prompt === 'state.extract' || r.prompt === 'state.repair') {
      const contentId = x.contentId,
        eventId = uuid(),
        characterId = Object.keys(x.state.characters)[0],
        old = x.state.characters[characterId].conditions;
      const assertions = [];
      const changes = [];
      const change = {
        collection: 'characters' as const,
        key: characterId,
        operation: 'SET_FIELDS' as const,
        expected: { conditions: old },
        values: { conditions: this.invalidState ? 42 : [`已检查第${x.state.chapterNo + 1}章旧钟`] },
        eventId,
        order: 0,
      };
      changes.push(change);
      const propositionId = Object.keys(x.state.propositions)[0];
      if (this.flipFirstPropositionTruth && propositionId) {
        const currentVersionId = x.state.propositions[propositionId].currentVersionId;
        const propositionVersion = {
          id: uuid(),
          propositionId,
          truth: 'FALSE' as const,
          changeKind: 'WORLD_CHANGE' as const,
          effectiveAtEventId: { kind: 'CONTENT' as const, id: eventId },
          recordedAtEventId: { kind: 'CONTENT' as const, id: eventId },
          supersedesVersionId: currentVersionId,
          correctsVersionId: null,
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
              assertion: 'EXPLICIT_NARRATION' as const,
              note: '故障注入：改写命题真值',
            },
          ],
        };
        assertions.push(propositionVersion);
        changes.push({
          collection: 'propositions' as const,
          key: propositionId,
          operation: 'SET_FIELDS' as const,
          expected: { currentVersionId },
          values: { currentVersionId: propositionVersion.id },
          eventId,
          order: 1,
        });
      }
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
        assertions,
        proposedChanges: changes,
      };
      result = {
        events: [e],
        delta: {
          baseSnapshotId: x.baseSnapshotId,
          contentVersionId: contentId,
          eventIds: [eventId],
          changes,
          propositionVersions: assertions,
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
    if (
      r.prompt === 'planning.book' &&
      x.knowledge?.items.some((i: any) => i.kind === 'FRAMEWORK')
    ) {
      const o = result as Opening;
      o.adaptationMap = x.knowledge.items
        .filter((i: any) => i.kind === 'FRAMEWORK')
        .flatMap((i: any) =>
          i.payload.nodes.slice(0, 1).map((n: any) => ({
            sourceNodeId: n.id,
            newPlanNodeId: o.book.id,
            retainedFunction: n.function,
            changedPremise: '将旧地图的线索结构改编为渡口来信',
          })),
        );
    }
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
