/**
 * Context block assembly — builds typed PromptContextBlock[] for chapter generation.
 * Extracted from contextAssembler.ts to keep each file ~100 lines.
 */

import { getPrisma } from "../../../../platform/db/client";
import { resolveStyleContext } from "../../../style/styleRuntimeResolver";
import { selectRelevantRules, activateRulesForChapter, getActiveRulesContext } from "../../world/ruleActivationService";
import { getActiveConflicts } from "../openConflict";
import { getTimelineContext } from "../../../timeline/timelineService";
import { compileScenePlanContext } from "./scenePlanService";
import { createContextBlock } from "../../../../platform/llm/contextBlockBudget";
import type { PromptContextBlock } from "../../../../platform/llm/promptTypes";
import { generateChapterDynamics, compileDynamicsContext } from "../../planning/characterPrep/characterDynamicsService";
import { getActivePayoffContext } from "../../../payoff/payoffService";
import { buildLiveFraming, buildLiveCharacters } from "../characterFormatting";
import { buildTieredContext } from "./tieredCompressionService";
import { buildCharacterProhibitions } from "../quality/characterProhibitions";
import type { CharacterProhibition } from "../quality/characterProhibitions";

// ─── Shared DB fetch (exported for assembleChapterContext reuse) ───

export async function fetchAssemblyBase(novelId: string, chapterId: string) {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      id: true, title: true, genre: true, writingScale: true,
      storySummary: true, centralQuestion: true, endingDirection: true,
      pacePreference: true, styleTone: true, narrativePov: true, emotionIntensity: true,
      targetAudience: true, bookSellingPoint: true, competingFeel: true, first30ChapterPromise: true,
      commercialTags: true, structuredOutline: true, estimatedChapterCount: true,
      chapters: { orderBy: { order: "asc" } },
      characters: { take: 15 },
    },
  });
  if (!novel) throw new Error("Novel not found");

  const chapter = novel.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const prevChapters = novel.chapters.filter((c) => c.order < chapter.order);
  const lastChapter = prevChapters[prevChapters.length - 1] ?? null;

  return { novel, chapter, prevChapters, lastChapter };
}

// ─── Block assembler ──────────────────────────────────────

export async function assembleChapterBlocks(
  novelId: string,
  chapterId: string,
): Promise<PromptContextBlock[]> {
  const { novel, chapter, prevChapters, lastChapter } = await fetchAssemblyBase(novelId, chapterId);
  const prisma = getPrisma();

  const blocks: PromptContextBlock[] = [];

  // ── book_contract — read directly from Novel columns ──
  const storyCoreContent = [
    novel.storySummary ? `故事简介：${novel.storySummary}` : null,
    novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : null,
    novel.endingDirection ? `结局方向：${novel.endingDirection}` : null,
    novel.targetAudience ? `目标读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `核心卖点：${novel.bookSellingPoint}` : null,
    novel.competingFeel ? `差异化：${novel.competingFeel}` : null,
    novel.first30ChapterPromise ? `前30章承诺：${novel.first30ChapterPromise}` : null,
  ].filter(Boolean).join("\n");
  if (storyCoreContent) {
    blocks.push(createContextBlock({
      id: "book_contract", group: "book_contract", priority: 104, required: true,
      content: storyCoreContent, conflictGroup: "book_contract", freshness: 2,
    }));
  }
  const liveFraming = buildLiveFraming(novel);
  if (liveFraming) {
    blocks.push(createContextBlock({
      id: "book_contract_live", group: "book_contract", priority: 103, required: false,
      content: liveFraming, conflictGroup: "book_contract", freshness: 1,
    }));
  }

  // ── chapter_mission ──
  const chapterPlan = await prisma.volumeChapterPlan.findFirst({
    where: { chapterId: chapter.id },
    select: { purpose: true, exclusiveEvent: true, endingState: true, mustAvoid: true, chapterOrder: true, summary: true, loopPhase: true, chapterType: true, coolPointType: true, volume: { select: { title: true, summary: true } } },
  });
  const missionParts = [`本章任务：${chapter.expectation ?? "推进主线"}`];
  if (chapterPlan?.purpose) missionParts.push(`核心目的：${chapterPlan.purpose}`);
  if (chapterPlan?.exclusiveEvent) missionParts.push(`独占事件：${chapterPlan.exclusiveEvent}`);
  if (chapterPlan?.endingState) missionParts.push(`结束状态：${chapterPlan.endingState}`);
  if (chapterPlan?.mustAvoid) missionParts.push(`必须避免：${chapterPlan.mustAvoid}`);
  // Phase 2: Loop-phase specific instruction for long-form
  if (chapterPlan?.loopPhase) {
    const phaseGuide = getLoopPhaseGuide(chapterPlan.loopPhase, chapterPlan.chapterType, chapterPlan.coolPointType);
    if (phaseGuide) missionParts.push(`[回环阶段指引] ${phaseGuide}`);
  }
  blocks.push(createContextBlock({
    id: "chapter_mission", group: "chapter_mission", priority: 100, required: true,
    content: missionParts.join("\n"),
  }));

  // ── previous_chapter_hook ──
  if (lastChapter?.content) {
    blocks.push(createContextBlock({
      id: "previous_chapter_hook", group: "previous_chapter_hook", priority: 100, required: true,
      content: `上一章结尾：\n${lastChapter.content.slice(-600)}`,
    }));
  }

  // ── character_hard_facts — read directly from NovelCharacter/NovelCharacterRelation ──
  const liveChars = buildLiveCharacters(novel);
  if (liveChars) {
    blocks.push(createContextBlock({
      id: "character_hard_facts", group: "character_hard_facts", priority: 99, required: true,
      content: liveChars, conflictGroup: "character_hard_facts", freshness: 1,
    }));
  }

  // ── character_dynamics (Phase 2.1) ──
  try {
    const dynamics = await generateChapterDynamics(novelId, chapterId);
    const dynamicsContent = compileDynamicsContext(dynamics);
    if (dynamicsContent) {
      blocks.push(createContextBlock({
        id: "character_dynamics", group: "character_dynamics", priority: 97,
        content: dynamicsContent,
      }));
    }
  } catch { /* character dynamics is best-effort */ }

  // ── style_contract ──
  const styleCtx = await resolveStyleContext(novelId, chapter.id);
  if (styleCtx.styleBlock) {
    blocks.push(createContextBlock({
      id: "style_contract", group: "style_contract", priority: 74, required: true,
      content: styleCtx.styleBlock,
    }));
  }
  if (styleCtx.antiAiPrompt) {
    blocks.push(createContextBlock({
      id: "opening_constraints", group: "opening_constraints", priority: 80,
      content: styleCtx.antiAiPrompt,
    }));
  }

  // ── reference_counterpart — reference book chapter at similar position ──
  try {
    const refCounterpart = await buildReferenceCounterpart(novelId, chapter.order);
    if (refCounterpart) {
      blocks.push(createContextBlock({
        id: "reference_counterpart",
        group: "style_contract",
        priority: 85,
        required: false,
        content: refCounterpart,
      }));
    }
  } catch { /* best-effort */ }

  // ── reference_style_hints — writing assets from reference book ──
  try {
    const refStyleHints = await buildReferenceStyleHints(novelId);
    if (refStyleHints) {
      blocks.push(createContextBlock({
        id: "reference_style_hints",
        group: "style_contract",
        priority: 72,
        required: false,
        content: refStyleHints,
        conflictGroup: "style_contract",
        freshness: 1,
      }));
    }
  } catch { /* reference style hints is best-effort */ }

  // ── payoff_directives ──
  const payoffContext = await getActivePayoffContext(novelId, chapter.order);
  if (payoffContext) {
    blocks.push(createContextBlock({
      id: "payoff_directives", group: "payoff_directives", priority: 98,
      content: payoffContext,
    }));
  }

  // ── story_macro — read directly from VolumeChapterPlan ──
  const outlineContent = (() => {
    if (chapterPlan) {
      const volTitle = chapterPlan.volume?.title ?? "";
      const volSummary = chapterPlan.volume?.summary ?? "";
      const mission = chapter.expectation ?? chapterPlan.summary ?? "推进主线";
      return `当前卷：${volTitle} — ${volSummary}\n本章目标：${mission}`;
    }
    return null;
  })();
  if (outlineContent) {
    blocks.push(createContextBlock({
      id: "story_macro", group: "story_macro", priority: 98,
      content: outlineContent,
    }));
  }

  // ── volume_window (single block) ──
  const volumeWindowContent = chapterPlan
    ? `卷：${chapterPlan.volume?.title ?? ""} · 第${chapterPlan.chapterOrder}章 · 目标：${chapter.expectation ?? chapterPlan.summary ?? "推进主线"}`
    : outlineContent ?? `本章目标：${chapter.expectation ?? "推进主线"}`;
  blocks.push(createContextBlock({
    id: "volume_window", group: "volume_window", priority: 96, required: true,
    content: volumeWindowContent,
  }));

  // ── open_conflicts ──
  const openConflicts = await getActiveConflicts(novelId);
  if (openConflicts) {
    blocks.push(createContextBlock({
      id: "open_conflicts", group: "open_conflicts", priority: 88,
      content: openConflicts,
    }));
  }

  // ── recent_chapters ──
  // Tiered compression for long-form novels (4-tier context)
  if (prevChapters.length > 3) {
    try {
      const tiered = await buildTieredContext(novelId, chapter.order);
      if (tiered.tier1Adjacent) {
        blocks.push(createContextBlock({
          id: "recent_chapters", group: "recent_chapters", priority: 86,
          content: tiered.tier1Adjacent,
        }));
      }
      if (tiered.tier2Recent) {
        blocks.push(createContextBlock({
          id: "recent_skeleton", group: "recent_chapters", priority: 80,
          content: tiered.tier2Recent,
        }));
      }
      if (tiered.tier3VolumeSummary) {
        blocks.push(createContextBlock({
          id: "volume_summary", group: "volume_window", priority: 82,
          content: tiered.tier3VolumeSummary,
        }));
      }
      if (tiered.tier4Archive) {
        blocks.push(createContextBlock({
          id: "volume_archive", group: "story_macro", priority: 75,
          content: tiered.tier4Archive,
        }));
      }
    } catch { /* fall through */ }
  } else {
    const recentContent = prevChapters.slice(-5).map((c) => {
      const excerpt = c.content?.slice(0, 200)?.replace(/<[^>]*>/g, "") ?? "";
      return `第${c.order}章 ${c.title}：${c.expectation ?? ""}${excerpt ? `\n  节选：${excerpt}...` : ""}`;
    }).join("\n\n");
    if (recentContent) {
      blocks.push(createContextBlock({
        id: "recent_chapters", group: "recent_chapters", priority: 86,
        content: recentContent,
      }));
    }
  }

  // ── timeline ──
  const timelineContext = await getTimelineContext(novelId, chapter.order);
  if (timelineContext) {
    blocks.push(createContextBlock({
      id: "timeline", group: "recent_chapters", priority: 85,
      content: timelineContext,
    }));
  }

  // ── world_rules ──
  const chapterContextForActivation = [
    chapter.expectation ?? "", chapter.title ?? "", outlineContent ?? "", liveChars,
  ].join(" ");
  const relevantRules = await selectRelevantRules(novelId, chapterContextForActivation);
  activateRulesForChapter(novelId, chapter.id, chapterContextForActivation).catch(() => {});
  const worldRules = getActiveRulesContext(relevantRules);
  if (worldRules) {
    blocks.push(createContextBlock({
      id: "world_rules", group: "story_macro", priority: 90,
      content: worldRules,
    }));
  }

  // ── scene_plan ──
  try {
    const cards = chapter.scenePlan ? JSON.parse(chapter.scenePlan) : null;
    if (cards?.scenes && Array.isArray(cards.scenes) && cards.scenes.length > 0 && cards.enabled !== false) {
      const spContext = compileScenePlanContext({ scenes: cards.scenes, scenePlanGenerated: true, enabled: true });
      if (spContext) {
        blocks.push(createContextBlock({
          id: "scene_plan", group: "volume_window", priority: 93,
          content: spContext,
        }));
      }
    }
  } catch { /* ignore parse error */ }

  return blocks;
}

// ─── Chapter Context (flat representation for repair/diagnosis) ───

export interface ChapterContext {
  novelTitle: string; novelGenre: string | null;
  chapterTitle: string; chapterOrder: number; totalChapters: number;
  chapterExpectation: string | null; chapterHook: string | null;
  previousChapters: string; lastChapterEnding: string;
  characters: string; framing: string; outline: string;
  styleContext: string; antiAiPrompt: string;
  openConflicts: string; payoffContext: string; timelineContext: string;
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>;
  worldRules: string;
  scenePlanContext: string;
}

function findBlockContent(blocks: PromptContextBlock[], id: string): string {
  return blocks.find(b => b.id === id)?.content ?? "";
}

function blocksToChapterContext(
  base: Awaited<ReturnType<typeof fetchAssemblyBase>>,
  blocks: PromptContextBlock[],
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>,
): ChapterContext {
  const { novel, chapter } = base;

  const framing =
    findBlockContent(blocks, "book_contract_snapshot") ||
    findBlockContent(blocks, "book_contract_live");
  const characters =
    findBlockContent(blocks, "character_hard_facts_snapshot") ||
    findBlockContent(blocks, "character_hard_facts_live");
  const outline =
    findBlockContent(blocks, "volume_window_snapshot") ||
    findBlockContent(blocks, "volume_window_live") ||
    findBlockContent(blocks, "story_macro");

  return {
    novelTitle: novel.title,
    novelGenre: novel.genre,
    chapterTitle: chapter.title,
    chapterOrder: chapter.order,
    totalChapters: novel.chapters.length,
    chapterExpectation: chapter.expectation,
    chapterHook: chapter.hook,
    previousChapters: findBlockContent(blocks, "recent_chapters"),
    lastChapterEnding: findBlockContent(blocks, "previous_chapter_hook"),
    characters,
    framing,
    outline,
    styleContext: findBlockContent(blocks, "style_contract"),
    antiAiPrompt: findBlockContent(blocks, "opening_constraints"),
    openConflicts: findBlockContent(blocks, "open_conflicts"),
    payoffContext: findBlockContent(blocks, "payoff_directives"),
    timelineContext: findBlockContent(blocks, "timeline"),
    worldRules: findBlockContent(blocks, "world_rules"),
    scenePlanContext: findBlockContent(blocks, "scene_plan"),
    characterProhibitions,
  };
}

/**
 * Assemble flat ChapterContext for repair, scene planning, and diagnosis.
 * Delegates to assembleChapterBlocks() → blocksToChapterContext().
 */
export async function assembleChapterContext(novelId: string, chapterId: string): Promise<ChapterContext> {
  const base = await fetchAssemblyBase(novelId, chapterId);
  const blocks = await assembleChapterBlocks(novelId, chapterId);
  const characterProhibitions = await buildCharacterProhibitions(novelId);
  return blocksToChapterContext(base, blocks, characterProhibitions);
}

// ─── Loop Phase Writing Guide (Phase 2) ──────────────────

const LOOP_PHASE_GUIDES: Record<string, string> = {
  trigger: "本章处于「触发事件」阶段——应引入新的副本/任务/危机，建立本轮回环的驱动力。开头应快速进入情境，结尾暗示本轮的主要挑战。",
  enter: "本章处于「进入探索」阶段——主角进入新环境，应侧重感官描写和初步线索收集。为后续展开埋下伏笔，保持好奇心牵引。",
  explore: "本章处于「深入展开」阶段——副本内展开，应推进核心探索/调查。揭示部分信息但保留更大谜团，让读者持续猜测真相。",
  setback: "本章处于「受挫考验」阶段——主角遭遇重大阻碍或失败。应制造真实的威胁感和挫败感，但保留翻盘的希望。这是情绪曲线的低谷，应让读者担心主角。",
  turn: "本章处于「转折翻盘」阶段——局势逆转。主角利用已有资源/信息实现翻盘，应侧重策略推演或意外发现的快感。让读者感到「原来如此」。",
  climax: "本章处于「决战高潮」阶段——与最大威胁的最终对抗。应充分调动前面积累的所有线索和能力，给予读者最大程度的满足。节奏应快速、密集。",
  settlement: "本章处于「结算收获」阶段——胜负已分，进入收获和复盘。明确本轮回环的成果（新能力/新信息/新身份），同时暗示下一轮回环的方向。应为读者提供情绪缓冲和期待。",
};

function getLoopPhaseGuide(
  loopPhase: string | null,
  chapterType: string | null,
  coolPointType: string | null,
): string | null {
  const guide = loopPhase ? LOOP_PHASE_GUIDES[loopPhase] : null;
  if (!guide) return null;

  const extras: string[] = [];
  if (chapterType === "climax") extras.push("本章被标记为高潮章，应全力推进剧情，保持高密度冲突。");
  if (chapterType === "cooldown") extras.push("本章是冷却章，应侧重情绪消化和角色互动，但不可完全停止推进。");
  if (chapterType === "transition") extras.push("本章是过渡章，可做日常/修炼/旅行描写，但结尾应有钩子。");
  if (coolPointType) extras.push(`本章预期爽点类型为「${coolPointType}」——确保正文中有对应的满足感。`);

  return extras.length > 0 ? `${guide} ${extras.join(" ")}` : guide;
}

// ─── Reference Style Hints (Phase 4) ─────────────────────

interface WritingTechnique {
  category: string;
  observation: string;
  rule: string;
  confidence: number;
}

interface WritingAssetCollection {
  overallStyleDescription: string;
  narrativeAssets: WritingTechnique[];
  languageAssets: WritingTechnique[];
  characterAssets: WritingTechnique[];
  rhythmAssets: WritingTechnique[];
  antiAiAssets: WritingTechnique[];
}

const CATEGORY_LABELS: Record<string, string> = {
  narrativeAssets: "叙事技法",
  languageAssets: "语言风格",
  characterAssets: "角色塑造",
  rhythmAssets: "节奏控制",
  antiAiAssets: "反AI特征",
};

async function buildReferenceStyleHints(novelId: string): Promise<string | null> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (!rb?.writingAssets) return null;

  let assets: WritingAssetCollection;
  try {
    assets = JSON.parse(rb.writingAssets) as WritingAssetCollection;
  } catch {
    return null;
  }

  const parts: string[] = [];

  // Overall style description
  if (assets.overallStyleDescription) {
    parts.push(`## 对标书风格参考\n\n**整体风格：** ${assets.overallStyleDescription}`);
  } else {
    parts.push("## 对标书风格参考");
  }

  // Top 2 techniques per category
  const categories: Array<{ key: keyof WritingAssetCollection; label: string }> = [
    { key: "narrativeAssets", label: "叙事技法" },
    { key: "languageAssets", label: "语言风格" },
    { key: "characterAssets", label: "角色塑造" },
    { key: "rhythmAssets", label: "节奏控制" },
    { key: "antiAiAssets", label: "反AI特征" },
  ];

  for (const { key, label } of categories) {
    const techniques = (assets[key] as WritingTechnique[] | undefined) ?? [];
    // Sort by confidence descending, take top 2
    const top2 = [...techniques]
      .filter(t => t.confidence >= 0.4)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2);

    if (top2.length > 0) {
      const rules = top2.map(t => `- ${t.rule}`).join("\n");
      parts.push(`### ${label}\n${rules}`);
    }
  }

  if (parts.length <= 1) return null; // Only the header, no techniques
  return parts.join("\n\n");
}

// ─── Reference Counterpart — maps current chapter to similar position in reference book ──

async function buildReferenceCounterpart(novelId: string, chapterOrder: number): Promise<string | null> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({
    where: { novelId },
    select: { annotations: true, totalChapters: true, content: true },
  });
  if (!rb?.annotations || !rb?.totalChapters) return null;

  let annotations: {
    loopBoundaries?: Array<{ chapterIndex: number; type: "start" | "end" }>;
    highCoolChapters?: number[];
    coolPointDensity?: Array<{ chapterIndex: number; level: string }>;
  };
  try { annotations = JSON.parse(rb.annotations); } catch { return null; }

  // Find total chapters in current novel for proportional mapping
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { estimatedChapterCount: true, chapters: { select: { id: true } } },
  });
  const totalNovelChapters = novel?.estimatedChapterCount ?? novel?.chapters.length ?? 333;

  // Map current chapter order to reference book chapter index proportionally
  const refTotal = rb.totalChapters;
  const refChapterIndex = Math.max(1, Math.min(refTotal, Math.round((chapterOrder / totalNovelChapters) * refTotal)));

  // Find the loop this reference chapter belongs to
  const loops = annotations.loopBoundaries ?? [];
  const currentLoop = loops
    .filter(b => b.chapterIndex <= refChapterIndex && b.type === "start")
    .sort((a, b) => b.chapterIndex - a.chapterIndex)[0];

  const coolDensity = annotations.coolPointDensity ?? [];
  const nearbyCool = coolDensity.filter(
    c => c.chapterIndex >= refChapterIndex - 3 && c.chapterIndex <= refChapterIndex + 3
  );

  const parts: string[] = [];
  parts.push(`对标书位置映射：第${refChapterIndex}章/${refTotal}章`);

  if (currentLoop) {
    parts.push(`所在回环起点：第${currentLoop.chapterIndex}章`);
  }

  if (nearbyCool.length > 0) {
    const highCount = nearbyCool.filter(c => c.level === "high").length;
    const lowCount = nearbyCool.filter(c => c.level === "low").length;
    parts.push(`附近±3章爽点密度：${highCount}高/${nearbyCool.length - highCount - lowCount}中/${lowCount}低`);
  }

  // Get actual chapter snippet if content available
  if (rb.content) {
    const chapterHeadingMatch = rb.content.match(
      new RegExp(`(?:^|\\n)\\s*(?:第${refChapterIndex}[章節节]|Chapter\\s+${refChapterIndex})`, 'im')
    );
    if (chapterHeadingMatch) {
      const start = chapterHeadingMatch.index!;
      const snippet = rb.content.slice(start, start + 500).replace(/\n/g, " ");
      parts.push(`对标书同位置章节开头：${snippet}...`);
    }
  }

  return parts.join("\n");
}
