/**
 * Context Assembler — orchestrator that assembles flat ChapterContext for repair,
 * scene planning, and diagnosis. Delegates block assembly to contextBlockBuilders.ts.
 */

import type { PromptContextBlock } from "../../../platform/llm/promptTypes";
import { buildCharacterProhibitions } from "./characterProhibitions";
import { fetchAssemblyBase, assembleChapterBlocks } from "./contextBlockBuilders";

// Re-export for backward compatibility
export { buildCharacterProhibitions, type CharacterProhibition } from "./characterProhibitions";
export { assembleRepairContext } from "./repairContext";
export { assembleChapterBlocks, fetchAssemblyBase } from "./contextBlockBuilders";

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

// ─── Block → flat context converter ────────────────────

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
