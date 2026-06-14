/**
 * Context block assembly — builds typed PromptContextBlock[] for chapter generation.
 * Extracted from contextAssembler.ts to keep each file ~100 lines.
 */

import { getPrisma } from "../../../platform/db/client";
import { resolveStyleContext } from "../../style/styleRuntimeResolver";
import { selectRelevantRules, activateRulesForChapter, getActiveRulesContext } from "../world/ruleActivationService";
import { getActiveConflicts } from "./openConflict";
import { getTimelineContext } from "../../timeline/timelineService";
import { compileScenePlanContext } from "./scenePlanService";
import { createContextBlock } from "../../../platform/llm/contextBlockBudget";
import type { PromptContextBlock } from "../../../platform/llm/promptTypes";
import { getLatestSnapshot } from "../planning/ConfirmationService";
import { generateChapterDynamics, compileDynamicsContext } from "../planning/characterPrep/characterDynamicsService";
import { getActivePayoffContext } from "../../payoff/payoffService";
import { formatCharactersFromSnapshot, buildLiveFraming, buildLiveCharacters } from "./characterFormatting";

// ─── Shared DB fetch (exported for assembleChapterContext reuse) ───

export async function fetchAssemblyBase(novelId: string, chapterId: string) {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { chapters: { orderBy: { order: "asc" } }, characters: { take: 15 } },
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

  // ── book_contract (snapshot + live conflict pair) ──
  const storySeedSnapshot = await getLatestSnapshot(novelId, "story_seed");

  if (storySeedSnapshot) {
    const content = [
      storySeedSnapshot.premise ? `故事前提：${storySeedSnapshot.premise}` : null,
      storySeedSnapshot.mainArc ? `主线：${storySeedSnapshot.mainArc}` : null,
      storySeedSnapshot.mysteryBox ? `核心悬念：${storySeedSnapshot.mysteryBox}` : null,
      storySeedSnapshot.endingDirection ? `结局方向：${storySeedSnapshot.endingDirection}` : null,
      storySeedSnapshot.targetAudience ? `目标读者：${storySeedSnapshot.targetAudience}` : null,
      storySeedSnapshot.bookSellingPoint ? `核心卖点：${storySeedSnapshot.bookSellingPoint}` : null,
      storySeedSnapshot.competingFeel ? `差异化：${storySeedSnapshot.competingFeel}` : null,
      storySeedSnapshot.first30ChapterPromise ? `前30章承诺：${storySeedSnapshot.first30ChapterPromise}` : null,
    ].filter(Boolean).join("\n");
    if (content) {
      blocks.push(createContextBlock({
        id: "book_contract_snapshot", group: "book_contract", priority: 104, required: true,
        content, conflictGroup: "book_contract", freshness: 2,
      }));
    }
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
    select: { purpose: true, exclusiveEvent: true, endingState: true, taskSheet: true, mustAvoid: true, chapterOrder: true, summary: true, volume: { select: { title: true, summary: true } } },
  });
  const missionParts = [`本章任务：${chapter.expectation ?? "推进主线"}`];
  if (chapterPlan?.purpose) missionParts.push(`核心目的：${chapterPlan.purpose}`);
  if (chapterPlan?.exclusiveEvent) missionParts.push(`独占事件：${chapterPlan.exclusiveEvent}`);
  if (chapterPlan?.endingState) missionParts.push(`结束状态：${chapterPlan.endingState}`);
  if (chapterPlan?.taskSheet) missionParts.push(`任务书：${chapterPlan.taskSheet}`);
  if (chapterPlan?.mustAvoid) missionParts.push(`必须避免：${chapterPlan.mustAvoid}`);
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

  // ── character_hard_facts (snapshot + live conflict pair) ──
  const characterSnapshot = await getLatestSnapshot(novelId, "characters");
  if (characterSnapshot) {
    const snapshotContent = formatCharactersFromSnapshot(characterSnapshot);
    if (snapshotContent) {
      blocks.push(createContextBlock({
        id: "character_hard_facts_snapshot", group: "character_hard_facts", priority: 99, required: true,
        content: snapshotContent, conflictGroup: "character_hard_facts", freshness: 2,
      }));
    }
  }
  const liveChars = buildLiveCharacters(novel);
  if (liveChars) {
    blocks.push(createContextBlock({
      id: "character_hard_facts_live", group: "character_hard_facts", priority: 98, required: false,
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

  // ── payoff_directives ──
  const payoffContext = await getActivePayoffContext(novelId, chapter.order);
  if (payoffContext) {
    blocks.push(createContextBlock({
      id: "payoff_directives", group: "payoff_directives", priority: 98,
      content: payoffContext,
    }));
  }

  // ── story_macro (DB VolumeChapterPlan → blueprint snapshot) ──
  const blueprintSnapshot = await getLatestSnapshot(novelId, "blueprint");
  const outlineContent = (() => {
    if (chapterPlan) {
      const volTitle = chapterPlan.volume?.title ?? "";
      const volSummary = chapterPlan.volume?.summary ?? "";
      const mission = chapter.expectation ?? chapterPlan.summary ?? "推进主线";
      return `当前卷：${volTitle} — ${volSummary}\n本章目标：${mission}`;
    }
    if (blueprintSnapshot) {
      const vol = (blueprintSnapshot.volumes as Array<{ sortOrder: number; title: string; summary: string; chapters: Array<{ order: number }> }>)
        ?.find((v: { chapters: Array<{ order: number }> }) =>
          v.chapters?.some((c: { order: number }) => c.order === chapter.order));
      if (vol) return `当前卷：${vol.title} — ${vol.summary ?? ""}\n本章目标：${chapter.expectation ?? "推进主线"}`;
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
