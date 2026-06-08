/** Token budget per task type. Chinese chars * 1.5 ≈ tokens. */
export const PROMPT_BUDGETS: Record<string, number> = {
  writer: 12000,
  reviewer: 4000,
  planner: 8000,
  extractor: 6000,
  compiler: 4000,
  repairer: 6000,
};

/** Per-block character limits to prevent any single block from dominating the context.
 *  These are applied before the global token budget cut. */
export const BLOCK_CHAR_LIMITS: Record<string, number> = {
  "书级定位": 800,
  "本章任务": 500,
  "前情提要": 1200,
  "上一章结尾": 600,
  "出场角色": 1500,
  "本章规划": 1000,
  "写法约束": 2000,
  "开放冲突": 600,
  "伏笔指令": 800,
  "时间线": 600,
  "世界规则": 600,
};

/** Drop order — lowest priority blocks are dropped first when over budget.
 *  Blocks NOT in this list are never dropped.
 *  Order: first entry = first to drop. */
export const BLOCK_DROP_ORDER: string[] = [
  "时间线",
  "开放冲突",
  "前情提要",
];

/** Chapter position types for adaptive drop strategy */
export type ChapterPosition = "first" | "early" | "climax" | "transition" | "normal";

/**
 * Get adaptive drop order based on chapter position.
 *
 * - first: No previous chapters, drop "前情提要" first (it's minimal anyway)
 * - climax: Keep planning obligations — only drop "时间线" and "开放冲突"
 * - transition: Can be aggressive — drop more context blocks
 * - early/normal: Use default order
 */
export function getChapterDropOrder(position: ChapterPosition): string[] {
  switch (position) {
    case "first":
      return ["前情提要", "时间线", "开放冲突"];
    case "climax":
      return ["时间线", "开放冲突"];
    case "transition":
      return ["时间线", "开放冲突", "前情提要", "写法约束"];
    default:
      return BLOCK_DROP_ORDER;
  }
}

/**
 * Detect chapter position from its order and total count.
 */
export function detectChapterPosition(
  chapterOrder: number,
  totalChapters: number,
): ChapterPosition {
  if (chapterOrder <= 1) return "first";
  if (chapterOrder <= 3) return "early";
  // Last 20% of chapters or explicitly marked as climax
  if (chapterOrder >= totalChapters * 0.8) return "climax";
  // Middle chapters with even order numbers are often transitions
  if (chapterOrder > 3 && chapterOrder < totalChapters * 0.5 && chapterOrder % 3 === 0) return "transition";
  return "normal";
}
