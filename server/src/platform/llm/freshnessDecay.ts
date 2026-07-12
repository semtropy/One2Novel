/**
 * Context Freshness Decay — 动态上下文排序
 *
 * 核心问题：contextSelection.ts 的优先级系统是二元的（>=90 保留，60-89 压缩，<60 丢弃）。
 * 但"第 100 章的世界规则"和"第 480 章的世界规则"优先级相同，这不合理。
 *
 * 解决方案：
 * 1. 每个 block 标注 freshnessGroup（不同组有不同的 decayRate）
 * 2. selectContextBlocks 在压缩前应用 freshnessDecay
 * 3. 同优先级下，更近的章节上下文优先保留
 */
import type { PromptContextBlock } from "./promptTypes";
import { DEFAULT_FRESHNESS_DECAY_RATE } from "../config/constants";

// ─── Freshness Groups ────────────────────────────────────

/**
 * 不同上下文组的衰减率（章数）。
 * 值越大 = 衰减越慢 = 旧内容保留越久。
 *
 * - character_state: 20 章（角色状态变化快）
 * - world_rule: 100 章（规则稳定）
 * - payoff: 50 章（伏笔时效性强）
 * - style: Infinity（风格不衰减）
 * - recent_chapters: 30 章（近期章节衰减中等）
 * - story_macro: 80 章（卷级导向相对稳定）
 */
export const FRESHNESS_DECAY_RATES: Record<string, number> = {
  character_hard_facts: 20,
  entity_lifecycle: 20,
  payoff_directives: 50,
  open_conflicts: 50,
  timeline: 30,
  story_macro: 80,
  volume_window: 80,
  style_contract: Infinity,
  opening_constraints: Infinity,
  writing_techniques: Infinity,
  craft_stats: Infinity,
  reference_exemplars: Infinity,
  expectation_chain: 50,
  expectation_profile: 50,
  content_beat_mission: Infinity,
  recent_chapters: 30,
  recent_skeleton: 30,
  volume_summary: 80,
  volume_archive: 200,
  story_contract: Infinity,
  chapter_mission: Infinity,
  previous_chapter_hook: Infinity,
  character_dynamics: 20,
  world_rules: 100,
  scene_plan: 50,
  book_contract: Infinity,
  book_contract_live: Infinity,
  rag_retrieval: 50, // RAG 结果跨距较大，衰减较慢
};

// ─── Freshness Decay Function ───────────────────────────

/**
 * 计算新鲜度衰减系数。
 *
 * @param chapterDistance 当前章节与内容来源章节的距离
 * @param decayRate 衰减率（越大衰减越慢）
 * @returns 衰减系数 (0.0 - 1.0)，1.0 = 完全不衰减
 */
export function freshnessDecay(chapterDistance: number, decayRate: number): number {
  if (decayRate === Infinity || decayRate <= 0) return 1.0;
  return 1.0 / (1.0 + chapterDistance / decayRate);
}

/**
 * 计算块的"有效优先级" = 原始优先级 × 新鲜度系数。
 * 用于在 token 预算紧张时做排序决策。
 */
export function effectivePriority(
  block: PromptContextBlock,
  chapterDistance: number,
): number {
  const decayRate = FRESHNESS_DECAY_RATES[block.group] ?? DEFAULT_FRESHNESS_DECAY_RATE;
  const decay = freshnessDecay(chapterDistance, decayRate);
  return block.priority * decay;
}

/**
 * 对上下文块按 effectivePriority 排序。
 * 在高优先级块之间，更近的块排在前面。
 */
export function sortByEffectivePriority(
  blocks: PromptContextBlock[],
  currentChapterOrder: number,
): PromptContextBlock[] {
  return blocks
    .map(block => ({
      ...block,
      _effectivePriority: effectivePriority(block, currentChapterOrder),
    }))
    .sort((a, b) => b._effectivePriority - a._effectivePriority);
}

// ─── Remove Hardcoded Limits ─────────────────────────────

/**
 * 替换硬编码的限制值。
 * 这些函数在调用方中使用，替代原来的固定数字。
 */

/**
 * 时间线上下文：不再限制 8+5，改为按 decayRate 排序。
 * @param items 时间线条目
 * @param currentChapter 当前章节
 * @param maxItems 最大返回数量（默认 30，足够覆盖长篇小说）
 */
export function getRelevantTimelineItems(
  items: Array<{ sortOrder: number; title: string; category: string; description?: string | null }>,
  currentChapter: number,
  maxItems: number = 30,
): Array<{ sortOrder: number; title: string; category: string; description?: string }> {
  // 按距离排序，最近的在前
  const sorted = items
    .map(item => ({
      ...item,
      distance: Math.abs(item.sortOrder - currentChapter),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxItems);

  return sorted.map(({ distance: _, ...rest }) => ({
    ...rest,
    description: rest.description ?? undefined,
  }));
}

/**
 * 开放冲突：不再限制 5 章，改为全量 + freshnessDecay。
 */
export function getRelevantConflicts(
  conflicts: Array<{ chapter: number; description: string; severity: string }>,
  currentChapter: number,
  maxItems: number = 15,
): Array<{ chapter: number; description: string; severity: string }> {
  const sorted = conflicts
    .map(c => ({
      ...c,
      score: c.severity === "high" ? 1.0 : c.severity === "medium" ? 0.7 : 0.3,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);

  return sorted.map(({ score: _, ...rest }) => rest);
}

/**
 * 角色动态：不再限制 10 章，改为全量。
 */
export function getRelevantCharacterDynamics(
  dynamics: Array<{ characterId: string; chapter: number; status: string }>,
  currentChapter: number,
  maxItems: number = 50,
): Array<{ characterId: string; chapter: number; status: string }> {
  return dynamics
    .sort((a, b) => b.chapter - a.chapter)
    .slice(0, maxItems);
}

/**
 * 伏笔回收：不再限制 50 章阈值，改为动态阈值。
 * 阈值 = min(100, 小说总章数 × 0.1)
 */
export function getPayoffStalenessThreshold(totalChapters: number): number {
  return Math.min(100, Math.max(50, Math.floor(totalChapters * 0.1)));
}
