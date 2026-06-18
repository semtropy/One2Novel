/**
 * Context block assembly — builds typed PromptContextBlock[] for chapter generation.
 * Extracted from contextAssembler.ts to keep each file ~100 lines.
 */

import { getPrisma } from "../../../../platform/db/client";
import { createNovelRepo, type NovelRepo } from "../../../../platform/data/repositories";
import { resolveStyleContext } from "../../../style/styleRuntimeResolver";
import { selectRelevantRules, activateRulesForChapter, getActiveRulesContext } from "../../world/ruleActivationService";
import { getActiveConflicts } from "../openConflict";
import { getTimelineContext } from "../../../timeline/timelineService";
import { compileScenePlanContext } from "./scenePlanService";
import { createContextBlock } from "../../../../platform/llm/contextSelection";
import type { PromptContextBlock } from "../../../../platform/llm/promptTypes";
import { generateChapterDynamics, compileDynamicsContext } from "../../planning/characterPrep/characterDynamicsService";
import { getActivePayoffContext } from "../../../payoff/payoffService";
import { buildLiveFraming, buildLiveCharacters } from "../characterFormatting";
import { buildTieredContext } from "./tieredCompressionService";
import { buildCharacterProhibitions } from "../quality/characterProhibitions";
import type { CharacterProhibition } from "../quality/characterProhibitions";

// ─── Shared DB fetch (exported for assembleChapterContext reuse) ───

export async function fetchAssemblyBase(novelId: string, chapterId: string, novelRepo?: NovelRepo) {
  const repo = novelRepo ?? createNovelRepo(getPrisma());
  const novel = await repo.findAssemblyBase(novelId);
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
    select: { purpose: true, exclusiveEvent: true, endingState: true, mustAvoid: true, chapterOrder: true, summary: true, loopPhase: true, chapterType: true, coolPointType: true, contentBeat: true, volume: { select: { title: true, summary: true } } },
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

  // ── expectation_profile (cool point recipe + hook targets from architecture step) ──
  try {
    const profileRaw = (await prisma.novel.findUnique({ where: { id: novelId }, select: { expectationProfile: true } }))?.expectationProfile;
    if (profileRaw) {
      const ep = JSON.parse(profileRaw);
      const parts: string[] = [];
      if (ep.coolPointRecipe) {
        const recipe = Object.entries(ep.coolPointRecipe as Record<string, number>)
          .map(([type, pct]) => `${({collect:"收集",strategy:"策略",verify:"验证",reveal:"揭示",upgrade:"升级"} as Record<string,string>)[type] ?? type}:${pct}%`).join(" ");
        parts.push(`爽点配方：${recipe}`);
      }
      if (ep.hookProfile) {
        parts.push(`钩子目标：每章${ep.hookProfile.shortTermPerChapter}个短期钩子 每卷${ep.hookProfile.mediumTermPerVolume}个中期钩子 ${ep.hookProfile.longTermLines}条长期线`);
      }
      if (ep.payoffWindow) parts.push(`伏笔回收窗口：${ep.payoffWindow}章`);
      if (parts.length > 0) {
        blocks.push(createContextBlock({
          id: "expectation_profile", group: "chapter_mission", priority: 95,
          content: `[架构期待参数]\n${parts.join("\n")}`,
        }));
      }
    }
  } catch { /* best-effort */ }

  // ── writing_techniques (from ArchitectureProfile, applied to chapter writing) ──
  try {
    const archProfileRaw = (await prisma.novel.findUnique({ where: { id: novelId }, select: { architectureProfile: true } }))?.architectureProfile;
    if (archProfileRaw) {
      const ap = JSON.parse(archProfileRaw);
      const wt = ap.writingTechniques;
      if (wt?.overallStyleDescription) {
        const lines = [`【对标书风格参考】${wt.overallStyleDescription}`];
        const cats = [
          { key: "narrativeAssets" as const, label: "叙事技法" },
          { key: "languageAssets" as const, label: "语言风格" },
          { key: "characterAssets" as const, label: "角色塑造" },
          { key: "rhythmAssets" as const, label: "节奏控制" },
          { key: "antiAiAssets" as const, label: "反AI特征" },
        ];
        for (const { key, label } of cats) {
          const techniques = (wt[key] as Array<{ rule: string }> | undefined) ?? [];
          if (techniques.length > 0) {
            lines.push(`\n${label}：${techniques.map((t: { rule: string }) => t.rule).join("；")}`);
          }
        }
        blocks.push(createContextBlock({
          id: "writing_techniques", group: "style_contract", priority: 76,
          content: lines.join("\n"), conflictGroup: "style_contract", freshness: 1,
        }));
      }
      // Craft stats from reference analysis (V2): opening patterns + dialogue ratio
      if (ap.craftStats) {
        const cs = ap.craftStats;
        const craftLines = ["【对标书写作手法】"];
        if (cs.dominantOpening) craftLines.push(`开场方式：${cs.dominantOpening}`);
        if (cs.dialogueRatio) craftLines.push(`对白密度：约${cs.dialogueRatio}%`);
        if (cs.descriptionDistribution) {
          const dd = cs.descriptionDistribution;
          craftLines.push(`描写分布：视觉${dd.visual}% 动作${dd.action}% 内心${dd.internal}% 感官${dd.sensory}%`);
        }
        if (craftLines.length > 1) {
          blocks.push(createContextBlock({
            id: "craft_stats", group: "style_contract", priority: 71,
            content: craftLines.join("\n"), conflictGroup: "style_contract", freshness: 1,
          }));
        }
      }
    }
  } catch { /* best-effort */ }

  // ── reference_exemplars — writing examples from reference book at similar structural position ──
  try {
    const novel2 = await prisma.novel.findUnique({ where: { id: novelId }, select: { activeProfileId: true } });
    if (novel2?.activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: novel2.activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        const ar = JSON.parse(refProfile.analysisResult);
        const exemplars = (ar.annotations as Array<{chapterIndex:number;chapterType:string;coolPointLevel:string;hookType:string;exemplarOpening?:string;exemplarEnding?:string;summary?:string}> | undefined);
        if (exemplars?.length) {
          // Match: same chapterType, similar coolPointLevel
          const targetType = chapterPlan?.chapterType ?? "advance";
          const targetCool = "medium"; // match by chapterType regardless of coolPointLevel
          const matches = exemplars.filter(e => e.chapterType === targetType || e.coolPointLevel === targetCool).slice(0, 3);
          if (matches.length > 0) {
            const lines = ["【对标书写作范例 — 相同结构位置的章节是怎么写的】"];
            for (const m of matches) {
              lines.push(`\n--- 对标书第${m.chapterIndex}章 (${m.chapterType}/${m.coolPointLevel}/${m.hookType}) ---`);
              if (m.summary) lines.push(`内容概要：${m.summary}`);
              if (m.exemplarOpening) lines.push(`开头写法：${m.exemplarOpening.slice(0, 200)}`);
              if (m.exemplarEnding) lines.push(`结尾钩子：${m.exemplarEnding.slice(0, 200)}`);
            }
            blocks.push(createContextBlock({
              id: "reference_exemplars", group: "style_contract", priority: 77,
              content: lines.join("\n"), conflictGroup: "style_contract", freshness: 1,
            }));
          }
        }
      }
    }
  } catch { /* best-effort */ }

  // ── content_beat_mission ──
  if (chapterPlan?.contentBeat) {
    const beatGuide = getContentBeatGuide(chapterPlan.contentBeat);
    blocks.push(createContextBlock({
      id: "content_beat_mission",
      group: "chapter_mission",
      priority: 98,
      content: `[本章内容节拍]\n类型：${chapterPlan.contentBeat}${beatGuide ? `\n写作指引：${beatGuide}` : ""}`,
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

// Content guides extracted to contentGuides.ts — keeps this file focused on block assembly
import { getLoopPhaseGuide, buildReferenceStyleHints, buildReferenceCounterpart, getContentBeatGuide } from "./contentGuides";
