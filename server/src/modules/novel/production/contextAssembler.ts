import { getPrisma } from "../../../platform/db/client";
import { resolveStyleBlock, resolveAntiAiPrompt } from "../../style/styleRuntimeResolver";
import { selectRelevantRules, activateRulesForChapter, getActiveRulesContext } from "../world/ruleActivationService";
import { getActiveConflicts } from "./openConflict";
import { getTimelineContext } from "../../timeline/timelineService";
import { selectByBudget } from "../../../platform/llm/contextBudget";
import {
  PROMPT_BUDGETS, BLOCK_CHAR_LIMITS,
  getChapterDropOrder, detectChapterPosition,
  type ChapterPosition,
} from "../../../platform/llm/promptBudgetProfiles";
import { compileScenePlanContext } from "./scenePlanService";

export interface ChapterContext {
  novelTitle: string; novelGenre: string | null;
  chapterTitle: string; chapterOrder: number; totalChapters: number;
  chapterExpectation: string | null; chapterHook: string | null;
  previousChapters: string; lastChapterEnding: string;
  characters: string; framing: string; outline: string;
  styleContext: string; antiAiPrompt: string;
  openConflicts: string; payoffContext: string; timelineContext: string;
  /** Structured character prohibitions for quality gate enforcement */
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>;
  /** Active world rules context block (on-demand activation) */
  worldRules: string;
  /** Scene-level storyboard plan for this chapter (Phase 14) */
  scenePlanContext: string;
}

/**
 * Assemble context blocks for chapter generation.
 * Maps old project's context groups to our data sources:
 *   book_contract → framing, chapter_mission → expectation,
 *   character_hard_facts → character profiles,
 *   recent_chapters → previous summaries,
 *   volume_window → current volume outline,
 *   style_contract → style bindings,
 *   open_conflicts → active conflicts,
 *   payoff_directives → active payoffs.
 */
export async function assembleChapterContext(novelId: string, chapterId: string): Promise<ChapterContext> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { chapters: { orderBy: { order: "asc" } }, characters: { take: 15 } },
  });
  if (!novel) throw new Error("Novel not found");

  const chapter = novel.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const prevChapters = novel.chapters.filter((c) => c.order < chapter.order);
  const lastChapter = prevChapters[prevChapters.length - 1];

  // book_contract — prefer confirmed snapshot if available
  const { getLatestSnapshot } = await import("../planning/ConfirmationService");
  const storySeedSnapshot = await getLatestSnapshot(novelId, "story_seed");

  let framing: string;
  if (storySeedSnapshot) {
    framing = [
      storySeedSnapshot.targetAudience ? `目标读者：${storySeedSnapshot.targetAudience}` : null,
      storySeedSnapshot.bookSellingPoint ? `核心卖点：${storySeedSnapshot.bookSellingPoint}` : null,
      storySeedSnapshot.competingFeel ? `差异化：${storySeedSnapshot.competingFeel}` : null,
      storySeedSnapshot.first30ChapterPromise ? `前30章承诺：${storySeedSnapshot.first30ChapterPromise}` : null,
    ].filter(Boolean).join("\n");
  } else {
    framing = buildLiveFraming(novel);
  }

  // character_hard_facts — prefer confirmed snapshot if available
  const characterSnapshot = await getLatestSnapshot(novelId, "characters");
  let characters: string;
  let characterProhibitions: Array<{ name: string; prohibitions: string[] }> | undefined;

  if (characterSnapshot) {
    const charList = (characterSnapshot.characters as Array<Record<string, unknown>>);
    characters = charList.map((c: Record<string, unknown>) => {
      const parts = [`${c.name}（${c.role}）`];
      if (c.personality) parts.push(`性格：${c.personality}`);
      if (c.currentGoal) parts.push(`目标：${c.currentGoal}`);
      if (c.appearance) parts.push(`外貌：${c.appearance}`);
      if (c.quirks) parts.push(`习惯：${c.quirks}`);
      if (c.currentStatus) parts.push(`状态：${c.currentStatus}`);
      if (c.voiceTexture) parts.push(`语感：${c.voiceTexture}`);
      if (c.identityLabel) parts.push(`身份：${c.identityLabel}`);
      if (c.prohibitions) parts.push(`底线：${c.prohibitions}`);
      return parts.join(" · ");
    }).join("\n");
    // Build structured prohibitions
    const proh = charList
      .filter(c => { const p = c.prohibitions as string[]; return Array.isArray(p) && p.length > 0; })
      .map(c => ({ name: c.name as string, prohibitions: c.prohibitions as string[] }));
    if (proh.length > 0) characterProhibitions = proh;
  } else {
    characters = buildLiveCharacters(novel);
    // Derive prohibitions from live characters
    const proh = novel.characters
      .filter(c => {
        try { const p = JSON.parse(c.prohibitions ?? "[]"); return Array.isArray(p) && p.length > 0; } catch { return false; }
      })
      .map(c => ({ name: c.name, prohibitions: JSON.parse(c.prohibitions ?? "[]") as string[] }));
    if (proh.length > 0) characterProhibitions = proh;
  }

  // recent_chapters — last 5 chapter summaries
  const previousChapters = prevChapters.slice(-5).map((c) => {
    const excerpt = c.content?.slice(0, 200)?.replace(/<[^>]*>/g, "") ?? "";
    return `第${c.order}章 ${c.title}：${c.expectation ?? ""}${excerpt ? `\n  节选：${excerpt}...` : ""}`;
  }).join("\n\n");

  // previous_chapter_hook — previous chapter ending
  const lastChapterEnding = lastChapter?.content?.slice(-600) ?? "";

  // volume_window — prefer confirmed blueprint snapshot if available
  const blueprintSnapshot = await getLatestSnapshot(novelId, "blueprint");
  const outline = (() => {
    if (blueprintSnapshot) {
      const vol = (blueprintSnapshot.volumes as Array<{ sortOrder: number; title: string; summary: string; chapters: Array<{ order: number }> }>)
        ?.find((v: { chapters: Array<{ order: number }> }) =>
          v.chapters?.some((c: { order: number }) => c.order === chapter.order));
      return vol ? `当前卷：${vol.title} — ${vol.summary ?? ""}\n本章目标：${chapter.expectation ?? "推进主线"}` : `本章目标：${chapter.expectation ?? "推进主线"}`;
    }
    if (!novel.structuredOutline) return `本章目标：${chapter.expectation ?? "推进主线"}`;
    try {
      const o = JSON.parse(novel.structuredOutline);
      const vol = o.volumes?.find((v: { chapters?: Array<{ order: number }> }) =>
        v.chapters?.some((c: { order: number }) => c.order === chapter.order));
      return vol ? `当前卷：${vol.title} — ${vol.summary ?? ""}\n本章目标：${chapter.expectation ?? "推进主线"}` : `本章目标：${chapter.expectation ?? "推进主线"}`;
    } catch { return `本章目标：${chapter.expectation ?? "推进主线"}`; }
  })();

  // style_contract — writing style constraints (resolved via pipeline: novel + chapter bindings)
  const [styleContext, antiAiPrompt] = await Promise.all([
    resolveStyleBlock(novelId, chapter.id),
    resolveAntiAiPrompt(novelId, chapter.id),
  ]);

  // open_conflicts — active conflicts in the story
  const openConflicts = await getActiveConflicts(novelId);

  // timeline_context — timeline events for continuity
  const timelineContext = await getTimelineContext(novelId, chapter.order);

  // world_rules — on-demand activation for this chapter
  const chapterContextForActivation = [
    chapter.expectation ?? "",
    chapter.title ?? "",
    outline,
    characters,
  ].join(" ");
  const relevantRules = await selectRelevantRules(novelId, chapterContextForActivation);
  await activateRulesForChapter(novelId, chapter.id, chapterContextForActivation).catch(() => {}); // Fire-and-forget activation record
  const worldRules = getActiveRulesContext(relevantRules);

  // payoff_directives — active payoffs that need advancement (Phase 15: enhanced)
  const { getActivePayoffContext } = await import("../../payoff/payoffService");
  const payoffContext = await getActivePayoffContext(novelId, chapter.order);

  // scene_plan — storyboard for this chapter
  let scenePlanContext = "";
  try {
    const cards = chapter.sceneCards ? JSON.parse(chapter.sceneCards) : null;
    if (cards?.scenes && Array.isArray(cards.scenes) && cards.scenes.length > 0) {
      scenePlanContext = compileScenePlanContext({ scenes: cards.scenes, scenePlanGenerated: true });
    }
  } catch { /* sceneCards parse error — ignore */ }

  return {
    novelTitle: novel.title, novelGenre: novel.genre,
    chapterTitle: chapter.title, chapterOrder: chapter.order,
    totalChapters: novel.chapters.length,
    chapterExpectation: chapter.expectation, chapterHook: chapter.hook,
    previousChapters, lastChapterEnding, characters, framing, outline,
    styleContext, antiAiPrompt, openConflicts, payoffContext, timelineContext,
    characterProhibitions, worldRules, scenePlanContext,
  };
}

// ─── Live-read fallbacks (used when no snapshot is locked) ───

function buildLiveFraming(novel: { targetAudience?: string | null; bookSellingPoint?: string | null; competingFeel?: string | null; first30ChapterPromise?: string | null }): string {
  return [
    novel.targetAudience ? `目标读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `核心卖点：${novel.bookSellingPoint}` : null,
    novel.competingFeel ? `差异化：${novel.competingFeel}` : null,
    novel.first30ChapterPromise ? `前30章承诺：${novel.first30ChapterPromise}` : null,
  ].filter(Boolean).join("\n");
}

function buildLiveCharacters(novel: { characters: Array<{ name: string; role: string; personality?: string | null; appearance?: string | null; quirks?: string | null; currentStatus?: string | null; currentGoal?: string | null; voiceTexture?: string | null; identityLabel?: string | null; prohibitions?: string | null }> }): string {
  return novel.characters.map((c) => {
    const parts = [`${c.name}（${c.role}）`];
    if (c.personality) parts.push(`性格：${c.personality}`);
    if (c.appearance) parts.push(`外貌：${c.appearance}`);
    if (c.quirks) parts.push(`习惯：${c.quirks}`);
    if (c.currentStatus) parts.push(`状态：${c.currentStatus}`);
    if (c.currentGoal) parts.push(`目标：${c.currentGoal}`);
    if (c.voiceTexture) parts.push(`语感：${c.voiceTexture}`);
    if (c.identityLabel) parts.push(`身份：${c.identityLabel}`);
    if (c.prohibitions) parts.push(`底线：${c.prohibitions}`);
    return parts.join(" · ");
  }).join("\n");
}

/** Apply token budget to context blocks for a given task type.
 *  Uses adaptive drop order based on chapter position (first/climax/transition/normal). */
export function trimContextByBudget(
  ctx: ChapterContext,
  taskType: keyof typeof PROMPT_BUDGETS,
  opts?: { chapterPosition?: ChapterPosition },
): string {
  const budget = PROMPT_BUDGETS[taskType] ?? 12000;
  const position = opts?.chapterPosition ?? detectChapterPosition(ctx.chapterOrder, ctx.totalChapters);
  const dropOrder = getChapterDropOrder(position);

  const blocks = [
    { text: ctx.framing ? `【书级定位】\n${ctx.framing}` : "", priority: 104, label: "书级定位" },
    { text: `【本章任务】\n${ctx.chapterExpectation ?? "推进主线"}`, priority: 100, label: "本章任务" },
    { text: ctx.previousChapters ? `【前情提要】\n${ctx.previousChapters}` : "", priority: 86, label: "前情提要" },
    { text: ctx.lastChapterEnding ? `【上一章结尾】\n${ctx.lastChapterEnding}` : "", priority: 100, label: "上一章结尾" },
    { text: ctx.characters ? `【出场角色】\n${ctx.characters}` : "", priority: 99, label: "出场角色" },
    { text: ctx.outline ? `【本章规划】\n${ctx.outline}` : "", priority: 96, label: "本章规划" },
    { text: ctx.scenePlanContext || "", priority: 93, label: "分镜计划" },
    { text: ctx.styleContext || "", priority: 74, label: "写法约束" },
    { text: ctx.openConflicts || "", priority: 88, label: "开放冲突" },
    { text: ctx.payoffContext || "", priority: 98, label: "伏笔指令" },
    { text: ctx.timelineContext || "", priority: 100, label: "时间线" },
    { text: ctx.worldRules || "", priority: 90, label: "世界规则" },
  ].filter(b => b.text);
  const selected = selectByBudget(blocks, budget, {
    blockLimits: BLOCK_CHAR_LIMITS,
    dropOrder,
  });
  return [
    `书名：《${ctx.novelTitle}》${ctx.novelGenre ? ` · ${ctx.novelGenre}` : ""}`,
    "",
    ...selected,
    "",
    `请创作第${ctx.chapterOrder}章《${ctx.chapterTitle}》。`,
    ctx.chapterHook ? `章尾悬念方向：${ctx.chapterHook}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Assemble a review-oriented context prompt.
 * Includes chapter obligations + character prohibitions so the reviewer
 * can check if the content respects them.
 */
export function assembleReviewContext(ctx: ChapterContext, contentExcerpt: string): string {
  const budget = PROMPT_BUDGETS.reviewer ?? 4000;
  // Review context: focus on what matters for quality assessment
  const blocks = [
    { text: `【本章任务】\n${ctx.chapterExpectation ?? "推进主线"}`, priority: 100, label: "本章任务" },
    { text: ctx.characters ? `【出场角色】\n${ctx.characters}` : "", priority: 99, label: "出场角色" },
    { text: ctx.outline ? `【本章规划】\n${ctx.outline}` : "", priority: 96, label: "本章规划" },
    { text: ctx.styleContext || "", priority: 74, label: "写法约束" },
    { text: ctx.payoffContext || "", priority: 98, label: "伏笔指令" },
    { text: `【待审章节正文】\n${contentExcerpt.slice(0, 6000)}`, priority: 100, label: "待审正文" },
    { text: ctx.worldRules || "", priority: 90, label: "世界规则" },
  ].filter(b => b.text);

  const reviewBlockLimits: Record<string, number> = {
    ...BLOCK_CHAR_LIMITS,
    "待审正文": 6000,
  };

  const selected = selectByBudget(blocks, budget, { blockLimits: reviewBlockLimits, dropOrder: ["写法约束"] });
  return [
    `书名：《${ctx.novelTitle}》${ctx.novelGenre ? ` · ${ctx.novelGenre}` : ""}`,
    `第${ctx.chapterOrder}章《${ctx.chapterTitle}》`,
    "",
    ...selected,
  ].filter(Boolean).join("\n");
}

/**
 * Assemble a repair-oriented context prompt.
 * Includes chapter obligations + issues to fix + original content.
 */
export function assembleRepairContext(
  ctx: ChapterContext,
  content: string,
  issues: string,
): { systemContext: string; repairPrompt: string } {
  // System context: what MUST be preserved
  const systemContext = [
    ctx.characters ? `【出场角色（不可违背）】\n${ctx.characters}` : "",
    ctx.payoffContext || "",
    ctx.outline ? `【本章必须完成】\n${ctx.outline}` : "",
  ].filter(Boolean).join("\n\n");

  // Repair prompt: issues + content for the LLM
  const repairPrompt = [
    `## 需要修复的问题\n${issues}`,
    "",
    "## 原文",
    content.slice(0, 8000),
  ].join("\n");

  return { systemContext, repairPrompt };
}
