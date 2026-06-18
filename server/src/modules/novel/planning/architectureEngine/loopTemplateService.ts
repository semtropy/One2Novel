/**
 * Loop Template Service — generates loop skeletons and expands volumes for long-form novels.
 */
import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";

/** 计算长篇网文的回环数：每轮回环约 18 章，最少 5 轮，500章≈28轮回环 */
export function computeLoopCount(estimatedChapterCount: number): number {
  return Math.max(5, Math.round(estimatedChapterCount / 18));
}
import { getPrisma } from "../../../../platform/db/client";
import { getArchitectureTemplate } from "./architectureRegistry";
import type { ArchitectureType, LoopSkeleton, LoopSkeletonItem, ExpandedVolume, ExpandedChapter, LoopPhase, CoolPointType, ChapterType } from "./types";

// ─── LLM Output Schemas ────────────────────────────────

const LoopSkeletonItemSchema = z.object({
  loopIndex: z.number().int(),
  triggerEvent: z.string(),
  dungeonName: z.string(),
  estimatedChapters: z.number().int().min(6).max(25),
  settlementContent: z.string(),
  scaleUpDirection: z.string(),
});

const LoopSkeletonSchema = z.object({
  loops: z.array(LoopSkeletonItemSchema),
});

const ExpandedChapterSchema = z.object({
  chapterOrder: z.number().int(),
  title: z.string(),
  summary: z.string(),
  loopPhase: z.enum(["trigger", "enter", "explore", "setback", "turn", "climax", "settlement"]),
  coolPointType: z.enum(["collect", "strategy", "verify", "reveal", "upgrade", "face_slap"]).optional(),
  hookType: z.enum(["short_term", "medium_term"]).optional(),
  chapterType: z.enum(["advance", "transition", "cooldown", "climax"]),
  contentBeat: z.string().optional(),
  expectation: z.string(),
  coreEvent: z.string(),
  endingHook: z.string(),
});

const ExpandedVolumeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  phases: z.array(z.object({
    phase: z.enum(["trigger", "enter", "explore", "setback", "turn", "climax", "settlement"]),
    label: z.string(),
    chapters: z.array(ExpandedChapterSchema),
  })),
});

// ─── Public API ─────────────────────────────────────────

export interface GenerateLoopSkeletonInput {
  novelId: string;
  architectureType: ArchitectureType;
  totalLoops?: number;  // User override; default calculated from estimatedChapterCount
}

/**
 * Generate a full loop skeleton for a long-form novel.
 * Based on the selected architecture, generates N loop iterations each with
 * trigger event, dungeon name, estimated chapters, settlement, and scale-up.
 */
export async function generateLoopSkeleton(input: GenerateLoopSkeletonInput): Promise<LoopSkeleton> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: input.novelId } });
  if (!novel) throw new Error("Novel not found");

  const arch = getArchitectureTemplate(input.architectureType);

  // Read story core directly from Novel columns
  const storyCoreContext = [
    novel.storySummary ? `故事简介：${novel.storySummary}` : null,
    novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : null,
    novel.endingDirection ? `结局方向：${novel.endingDirection}` : null,
  ].filter(Boolean).join("\n");

  // Calculate loop count
  const estimatedTotal = novel.estimatedChapterCount || 500;
  const loopCount = input.totalLoops || computeLoopCount(estimatedTotal);

  // Get golden finger context (unified JSON)
  let gfAbilities: string[] = [];
  let gfLimits: string[] = [];
  if (novel.goldenFinger) {
    try {
      const gf = JSON.parse(novel.goldenFinger);
      gfAbilities = Array.isArray(gf.abilities) ? gf.abilities : [];
      gfLimits = Array.isArray(gf.limits) ? gf.limits : [];
    } catch { /* ignore */ }
  }

  // Check for user-customized loop definition
  let customPhases: Array<{ phase: string; label: string; description: string; typicalChapterCount: [number, number] }> | null = null;
  if (novel.loopDefinition) {
    try {
      const def = JSON.parse(novel.loopDefinition);
      if (def.phases?.length > 0) customPhases = def.phases;
    } catch { /* use default */ }
  }

  // Read ArchitectureProfile for statistics-based parameters (from reference analysis or built-in template)
  let archProfileStats = "";
  if (novel.architectureProfile) {
    try {
      const ap = JSON.parse(novel.architectureProfile);
      if (ap.avgChaptersPerLoop) {
        archProfileStats += `\n【统计参考 — 对标书/模板的真实数据】`;
        archProfileStats += `\n平均每回环 ${ap.avgChaptersPerLoop.avg} 章（范围 ${ap.avgChaptersPerLoop.min}-${ap.avgChaptersPerLoop.max}）`;
        if (ap.chapterTypeDistribution) {
          archProfileStats += `\n章节类型分布 — 推进:${ap.chapterTypeDistribution.advance}% 过渡:${ap.chapterTypeDistribution.transition}% 冷却:${ap.chapterTypeDistribution.cooldown}% 高潮:${ap.chapterTypeDistribution.climax}%`;
        }
        if (ap.coolPointRecipe) {
          const recipe = ap.coolPointRecipe;
          archProfileStats += `\n爽点配比 — 收集:${recipe.collect}% 策略:${recipe.strategy}% 验证:${recipe.verify}% 揭示:${recipe.reveal}% 升级:${recipe.upgrade}% 打脸:${recipe.faceSlap}%`;
        }
        if (ap.hookProfile) {
          archProfileStats += `\n钩子密度 — 每章${ap.hookProfile.shortTermPerChapter}个短期 每卷${ap.hookProfile.mediumTermPerVolume}个中期 ${ap.hookProfile.longTermLines}条长线`;
        }
      }
    } catch { /* use defaults */ }
  }

  // Rhythm profile from reference analysis (V2)
  try {
    const activeProfileId = (await prisma.novel.findUnique({ where: { id: input.novelId }, select: { activeProfileId: true } }))?.activeProfileId;
    if (activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        const ar = JSON.parse(refProfile.analysisResult);
        const rp = ar.architecture?.rhythmProfile || ar.rhythmProfile; // V3+V2 compat
        if (rp) {
          archProfileStats += `\n【对标书节奏曲线】${rp.rhythmDescription}`;
          archProfileStats += `\n高潮间隔≈${rp.avgClimaxInterval}章 冷却段≈${rp.avgCooldownLength}章 周期≈${rp.tensionCycleLength}章`;
        }
      }
    }
  } catch {}

  const effectivePhases = customPhases ?? arch?.defaultLoop.phases ?? [];
  const effectivePhaseDesc = effectivePhases.map(p => `${p.label}（${p.description}，${p.typicalChapterCount[0]}-${p.typicalChapterCount[1]}章）`).join(" → ");

  const systemPrompt = arch
    ? [
        `你是资深网文架构师。根据以下信息为长篇网文生成回环骨架。`,
        "",
        `【架构类型】${arch.name}`,
        `【架构说明】${arch.description}`,
        `【回环阶段】${effectivePhaseDesc}`,
        `【每轮回环章数】${arch.defaultLoop.estimatedChaptersPerLoop[0]}-${arch.defaultLoop.estimatedChaptersPerLoop[1]}章`,
        `【结算类型】${arch.defaultLoop.settlementTypes.join("、")}`,
        `【升级方向】${arch.defaultLoop.scaleUpDirections.join("；")}`,
        "",
        `【回环数要求】${loopCount}轮回环`,
        "",
        `【生成原则】`,
        `1. 每轮回环必须有独立的触发事件和副本/事件名称，不得重复`,
        `2. 回环与回环之间必须形成递进关系——舞台逐步放大，敌人逐步增强`,
        `3. 结算内容必须具体可感知，不能是泛泛的「获得力量」`,
        `4. 舞台升级方向必须明确——读者能清楚感知下一轮回环比这一轮「大」在哪`,
        `5. 触发事件应随回环推进而升级：`,
        `   - 前半轮回环：外力触发`,
        `   - 后半轮回环：主角主动`,
        `6. 最终轮回环应指向全书的最大悬念和最终敌人`,
      ].join("\n")
    : [
        `你是资深网文架构师。根据故事设定自由设计回环骨架，不套用固定模板。`,
        "",
        `【回环结构说明】`,
        `每轮回环遵循 触发→展开→挫折→转折→高潮→结算 的自然节奏，`,
        `但具体阶段划分和占比应根据故事类型灵活调整。`,
        `悬疑类：信息揭示节奏更重要（揭示→误导→反转→再揭示）`,
        `升级类：能力提升节奏更重要（收集→验证→突破→新瓶颈）`,
        `办案类：案件推进节奏更重要（案发→调查→受阻→突破→收网）`,
        ``,
        `【回环数要求】${loopCount}轮回环，每轮15-25章`,
        ``,
        `【设计原则】`,
        `1. 根据故事的前提和主线，推断最自然的回环单元（如：副本/案件/晋升/事件），不要生搬硬套`,
        `2. 回环递进——舞台逐步放大，敌人逐步增强，代价逐步升级`,
        `3. 每轮的触发事件和结算内容必须具体，服务于主线的阶段推进`,
        `4. 最终回环指向全书最大悬念和最终敌人`,
      ].join("\n");

  // World rules context (Step 2 output → Step 4 input)
  const worldRules = await prisma.worldRule.findMany({
    where: { novelId: input.novelId, status: "active" },
    select: { category: true, title: true, content: true },
    take: 12,
  });
  let worldRulesContext = "";
  if (worldRules.length > 0) {
    worldRulesContext = `\n【世界规则】\n${worldRules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join("\n")}`;
  }

  const userPrompt = [
    `书名：《${novel.title}》`,
    novel.description ? `灵感：${novel.description.slice(0, 2000)}` : null,
    storyCoreContext,
    Array.isArray(gfAbilities) && gfAbilities.length > 0
      ? `金手指能力：${gfAbilities.join("、")}` : null,
    Array.isArray(gfLimits) && gfLimits.length > 0
      ? `金手指限制：${gfLimits.join("、")}` : null,
    worldRulesContext,
    archProfileStats,
  ].filter(Boolean).join("\n");

  // Feed reference book analysis as supplementary context
  const refBook = await prisma.referenceBook.findUnique({ where: { novelId: input.novelId } });
  let refContext = "";
  if (refBook?.annotations) {
    try {
      const annotations = JSON.parse(refBook.annotations);
      if (annotations.loopBoundaries?.length > 0) {
        const starts = annotations.loopBoundaries.filter((b: { type: string }) => b.type === "start");
        const ends = annotations.loopBoundaries.filter((b: { type: string }) => b.type === "end");
        refContext += `\n【参考书回环模式】该参考书约有${starts.length}-${ends.length}轮回环。参考其节奏分布。`;
      }
      if (annotations.highCoolChapters?.length > 0) {
        refContext += `\n【参考书爽点分布】高爽点集中在第${annotations.highCoolChapters.slice(0, 5).join("、")}章附近。`;
      }
    } catch { /* ignore */ }
  }

  const finalUserPrompt = userPrompt + refContext;

  const raw = await aiInvoke({
    assetId: "novel.loop-skeleton.generate",
    userPrompt: finalUserPrompt,
    schema: LoopSkeletonSchema,
    temperature: 0.8,
    novelId: input.novelId,
  });

  // Ensure indices are sequential
  const loops: LoopSkeletonItem[] = raw.loops.map((l, i) => ({
    loopIndex: i + 1,
    triggerEvent: l.triggerEvent,
    dungeonName: l.dungeonName,
    estimatedChapters: l.estimatedChapters,
    settlementContent: l.settlementContent,
    scaleUpDirection: l.scaleUpDirection,
  }));

  return {
    architectureType: input.architectureType,
    totalLoops: loops.length,
    loops,
    estimatedTotalChapters: loops.reduce((s, l) => s + l.estimatedChapters, 0),
  };
}

/**
 * Expand a single loop into a full volume with phase decomposition and chapter details.
 */
export async function expandLoopToVolume(
  novelId: string,
  loopIndex: number,
  skeleton: LoopSkeleton,
  previousVolumeSummaries?: string[],
): Promise<ExpandedVolume> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Fetch character roster for context injection (Step 3 output → Step 4 input)
  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { name: true, role: true, factionLabel: true },
  });
  const charContext = characters.length > 0
    ? `\n【角色阵容】\n${characters.map(c => `- ${c.name}（${c.role === "protagonist" ? "主角" : c.role === "antagonist" ? "对手" : "配角"}）${c.factionLabel ? ` [${c.factionLabel}]` : ""}`).join("\n")}`
    : "";

  const arch = getArchitectureTemplate(skeleton.architectureType);

  const loopItem = skeleton.loops.find(l => l.loopIndex === loopIndex);
  if (!loopItem) throw new Error(`Loop ${loopIndex} not found in skeleton`);

  // Check for user-customized loop definition
  let customPhases: Array<{ phase: string; label: string }> | null = null;
  if (novel.loopDefinition) {
    try {
      const def = JSON.parse(novel.loopDefinition);
      if (def.phases?.length > 0) customPhases = def.phases;
    } catch { /* use default */ }
  }
  const effectivePhases = customPhases ?? arch?.defaultLoop.phases ?? [];
  const effectivePhaseOrder = effectivePhases.map(p => p.label).join(" → ");

  // Get previous loop's settlement for context
  const prevLoop = skeleton.loops.find(l => l.loopIndex === loopIndex - 1);
  const prevVolContext = previousVolumeSummaries?.length
    ? `\n【前卷实际进展】\n${previousVolumeSummaries.map((s, i) => `第${i + 1}卷：${s}`).join("\n")}`
    : "";

  // Build content beat hint from novel profile or architecture default
  let contentBeatHint = "";
  let beatProfile: Record<string, { pct: number; span: string; label: string }> | null = null;
  if (novel.contentBeatProfile) {
    try { beatProfile = JSON.parse(novel.contentBeatProfile); } catch {}
  }
  if (!beatProfile && arch?.defaultContentBeats) {
    beatProfile = arch.defaultContentBeats;
  }
  if (beatProfile && Object.keys(beatProfile).length > 0) {
    const beatEntries = Object.entries(beatProfile);
    const chapterCount = loopItem.estimatedChapters;
    const beatAssignments = beatEntries.map(([type, def]) =>
      `  ${def.label}（${type}）：占比${def.pct}%，约${Math.round(chapterCount * def.pct / 100)}章，每段${def.span}`
    ).join("\n");
    contentBeatHint = `内容节拍配比（共${chapterCount}章）：\n${beatAssignments}`;
  }

  // ArchitectureProfile context for chapter type distribution (from reference book or template)
  let volumeArchContext = "";
  try {
    const ap = JSON.parse(novel.architectureProfile || "{}");
    if (ap.chapterTypeDistribution) {
      volumeArchContext = `\n【对标书章节类型分布】推进:${ap.chapterTypeDistribution.advance}% 过渡:${ap.chapterTypeDistribution.transition}% 冷却:${ap.chapterTypeDistribution.cooldown}% 高潮:${ap.chapterTypeDistribution.climax}%`;
    }
    if (ap.coolPointRecipe) {
      volumeArchContext += `\n【对标书爽点配比】收集:${ap.coolPointRecipe.collect}% 策略:${ap.coolPointRecipe.strategy}% 验证:${ap.coolPointRecipe.verify}% 揭示:${ap.coolPointRecipe.reveal}% 升级:${ap.coolPointRecipe.upgrade}% 打脸:${ap.coolPointRecipe.faceSlap}%`;
    }
    if (ap.hookProfile) {
      volumeArchContext += `\n【对标书钩子密度】每章${ap.hookProfile.shortTermPerChapter}个短期 每卷${ap.hookProfile.mediumTermPerVolume}个中期 ${ap.hookProfile.longTermLines}条长线`;
    }
  } catch {}

  const systemPrompt = arch
    ? [
        `你是资深网文分章策划师。将一回环（第${loopIndex}轮）展开为详细的卷章结构。`,
        "",
        `【架构阶段顺序】${effectivePhaseOrder}`,
        `【本章数限制】${loopItem.estimatedChapters}章（可±2章浮动）`,
        volumeArchContext,
        "",
        `【展开要求】`,
        `1. 按阶段顺序分配章节——不得跳过任何阶段`,
        `2. 每章填写：标题（≤8字）、摘要、阶段标签、核心事件、章尾钩子、章节类型`,
        `3. 章节类型规则（若有对标书数据，优先参考对标书分布）：`,
        `   - advance（推进章）：有实质剧情推进`,
        `   - transition（过渡章）：日常/修炼/旅行`,
        `   - cooldown（冷却章）：高潮后的情绪缓冲，每轮回环至少1章`,
        `   - climax（高潮章）：决战/揭示/仪式，每轮回环1-2章`,
        `4. 爽点类型按节奏分配（若有对标书数据，参考其配比）：collect/strategy/verify/reveal/upgrade/face_slap`,
        `5. 每章结尾必须有钩子（15-30字），推动读者继续阅读`,
        `6. 章与章之间要有因果推进关系`,
        `7. 每章标注内容节拍(contentBeat)，从以下类型中选择并按配比分配：`,
        ...(contentBeatHint ? [contentBeatHint] : []),
      ].join("\n")
    : [
        `你是资深网文分章策划师。将一回环（第${loopIndex}轮）展开为详细的卷章结构。`,
        ``,
        `【本章数限制】${loopItem.estimatedChapters}章（可±2章浮动）`,
        ``,
        `【展开要求】`,
        `1. 根据故事自然节奏划分阶段，每阶段1-4章，阶段之间形成因果推进`,
        `2. 每章的阶段标签(loopPhase)从 trigger/enter/explore/setback/turn/climax/settlement 中选择`,
        `3. 章节类型(chapterType)：advance(推进)/transition(过渡)/cooldown(冷却)/climax(高潮)`,
        `4. climax章控制在1-2章，cooldown章每轮至少1章`,
        `5. 每章结尾必须有钩子（15-30字）`,
      ].join("\n");

  const userPrompt = [
    `第${loopIndex}轮回环：${loopItem.dungeonName}`,
    `触发事件：${loopItem.triggerEvent}`,
    `预计章数：${loopItem.estimatedChapters}章`,
    `结算内容：${loopItem.settlementContent}`,
    `升级方向：${loopItem.scaleUpDirection}`,
    prevLoop ? `\n上一轮回环结算：${prevLoop.settlementContent}` : "",
    novel.centralQuestion ? `\n核心悬念（可在本回环中渐进揭示）：${novel.centralQuestion}` : "",
    charContext,
    prevVolContext,
  ].filter(Boolean).join("\n");

  // Expectation chain from reference analysis (V3)
  let expectationContext = "";
  try {
    const activeProfileId = (await prisma.novel.findUnique({ where: { id: novelId }, select: { activeProfileId: true } }))?.activeProfileId;
    if (activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        const ar = JSON.parse(refProfile.analysisResult);
        const expectations = ar.writing?.expectations;
        if (expectations?.length) {
          // Find the closest matching loop from the reference book
          const match = expectations.find((e: any) => e.loopIndex === loopIndex) || expectations[loopIndex % expectations.length];
          if (match) {
            expectationContext = `\n【对标书同等位置回环的期待链】期待类型=${match.expectationType} | 建立方式=${match.establishmentMethod} | 维持方式=${match.maintenanceMethod} | 兑现方式=${match.fulfillmentMethod}`;
          }
        }
      }
    }
  } catch {}
  const fullUserPrompt = [userPrompt, expectationContext].filter(Boolean).join("\n");

  const raw = await Promise.race([
    aiInvoke({
      assetId: "novel.volume.expand",
      userPrompt: fullUserPrompt,
      schema: ExpandedVolumeSchema,
      temperature: 0.8,
      novelId,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("卷展开超时（120秒），AI 响应过慢。请减少每卷章节数后重试。")), 120000)
    ),
  ]);

  // Assign chapter orders sequentially across all phases
  let globalOrder = 0;
  const phases = raw.phases.map(p => ({
    phase: p.phase as LoopPhase,
    label: p.label,
    chapters: p.chapters.map(c => {
      globalOrder++;
      return {
        chapterOrder: globalOrder,
        title: c.title,
        summary: c.summary,
        loopPhase: c.loopPhase as LoopPhase,
        coolPointType: c.coolPointType as CoolPointType | undefined,
        hookType: c.hookType as "short_term" | "medium_term" | undefined,
        chapterType: c.chapterType as ChapterType,
        expectation: c.expectation,
        coreEvent: c.coreEvent,
        endingHook: c.endingHook,
      } satisfies ExpandedChapter;
    }),
  }));

  return {
    sortOrder: loopIndex,  // 1:1 mapping of loop → volume
    title: raw.title,
    summary: raw.summary,
    loopIndex,
    phases,
    totalChapters: globalOrder,
  };
}
