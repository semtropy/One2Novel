import type { PromptContextBlock } from "./promptTypes";
import { sortByEffectivePriority } from "./freshnessDecay";
import { CTX_PRIORITY_FORCE_KEEP, CTX_PRIORITY_SUMMARIZE, CTX_PRIORITY_DROP } from "../config/constants";

export interface ContextSelectionResult {
  selectedBlocks: PromptContextBlock[];
  droppedBlockIds: string[];
  summarizedBlockIds: string[];
  estimatedTokens: number;
  budgetExceeded: boolean;
}

export interface TokenBudgetConfig {
  /** Maximum token budget (default: no limit). Typical: model context window * 0.7 */
  maxTokens?: number;
}

/**
 * Select context blocks with deduplication and optional token budget enforcement.
 *
 * When a maxTokens budget is set:
 *   - Priority >= CTX_PRIORITY_FORCE_KEEP (90): Always kept
 *   - Priority in [CTX_PRIORITY_SUMMARIZE, FORCE_KEEP): Summarized
 *   - Priority < CTX_PRIORITY_DROP (60): Dropped
 */
export function selectContextBlocks(
  blocks: PromptContextBlock[],
  budget?: TokenBudgetConfig,
  currentChapterOrder?: number,
): ContextSelectionResult {
  const normalizedBlocks = blocks.filter(
    (block) => block.content.trim().length > 0 && block.estimatedTokens > 0,
  );
  const deduped = dedupeConflictBlocks(normalizedBlocks);

  // Phase 4: 按有效优先级排序（考虑 freshnessDecay）
  let selectedBlocks = currentChapterOrder
    ? sortByEffectivePriority(deduped.kept, currentChapterOrder)
    : deduped.kept.sort((a, b) => b.priority - a.priority);
  let estimatedTokens = selectedBlocks.reduce((sum, b) => sum + b.estimatedTokens, 0);
  let budgetExceeded = false;
  const summarizedIds: string[] = [];

  // ── Token budget enforcement ──────────────────────────
  if (budget?.maxTokens && estimatedTokens > budget.maxTokens) {
    budgetExceeded = true;
    const droppedIds = new Set(deduped.droppedIds);
    const kept: PromptContextBlock[] = [];
    let used = 0;

    for (const block of selectedBlocks) {
      if (block.priority >= CTX_PRIORITY_FORCE_KEEP) {
        // High priority (book contract, previous chapter): always keep full content
        kept.push(block);
        used += block.estimatedTokens;
      } else if (block.priority >= CTX_PRIORITY_SUMMARIZE && used + block.estimatedTokens > budget.maxTokens && block.allowSummary !== false) {
        // Medium priority with summary allowed: truncate to fit remaining budget
        const remainingBudget = budget.maxTokens - used;
        if (remainingBudget > 100) {
          const truncated = truncateToFitTokens(block, remainingBudget);
          kept.push(truncated);
          summarizedIds.push(block.id);
          used += truncated.estimatedTokens;
        } else {
          droppedIds.add(block.id);
        }
      } else if (block.priority < CTX_PRIORITY_DROP && used + block.estimatedTokens > budget.maxTokens) {
        // Low priority: drop entirely
        droppedIds.add(block.id);
      } else {
        kept.push(block);
        used += block.estimatedTokens;
      }
    }

    selectedBlocks = kept;
    estimatedTokens = used;
    return { selectedBlocks, droppedBlockIds: [...droppedIds], summarizedBlockIds: summarizedIds, estimatedTokens, budgetExceeded };
  }

  return { selectedBlocks, droppedBlockIds: deduped.droppedIds, summarizedBlockIds: [], estimatedTokens, budgetExceeded: false };
}

/**
 * Within each conflictGroup, keep the most recent version and drop the older one.
 */
function dedupeConflictBlocks(blocks: PromptContextBlock[]): {
  kept: PromptContextBlock[];
  droppedIds: string[];
} {
  const droppedIds: string[] = [];
  const byConflictGroup = new Map<string, PromptContextBlock>();
  const kept: PromptContextBlock[] = [];

  for (const block of blocks) {
    if (!block.conflictGroup) {
      kept.push(block);
      continue;
    }

    const previous = byConflictGroup.get(block.conflictGroup);
    if (!previous) {
      byConflictGroup.set(block.conflictGroup, block);
      continue;
    }

    const prevFreshness = previous.freshness ?? 0;
    const nextFreshness = block.freshness ?? 0;
    const shouldReplace =
      nextFreshness > prevFreshness ||
      (nextFreshness === prevFreshness && block.priority > previous.priority) ||
      (nextFreshness === prevFreshness &&
        block.priority === previous.priority &&
        block.required &&
        !previous.required);

    if (shouldReplace) {
      droppedIds.push(previous.id);
      byConflictGroup.set(block.conflictGroup, {
        ...block,
        required: block.required || previous.required,
      });
    } else {
      if (block.required && !previous.required) {
        byConflictGroup.set(block.conflictGroup, { ...previous, required: true });
      }
      droppedIds.push(block.id);
    }
  }

  return { kept: [...kept, ...byConflictGroup.values()], droppedIds };
}

/**
 * Accurate token estimation for mixed Chinese/English text.
 * Chinese characters: ~1.5 tokens each (most LLM tokenizers)
 * ASCII/English: ~0.25 tokens per character (4 chars ≈ 1 token)
 */
function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let chineseChars = 0;
  let asciiChars = 0;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) {
      chineseChars++;
    } else if (code < 128) {
      asciiChars++;
    } else {
      // Other CJK / fullwidth: treat as Chinese
      chineseChars++;
    }
  }

  return Math.max(1, Math.ceil(chineseChars * 1.5 + asciiChars * 0.25));
}

/** Truncate block content to fit within a token budget. */
function truncateToFitTokens(block: PromptContextBlock, maxTokens: number): PromptContextBlock {
  // Conservative: truncate to roughly maxTokens * 0.7 characters (Chinese-dominant)
  const maxChars = Math.floor(maxTokens * 0.7);
  const truncated =
    block.content.length > maxChars
      ? block.content.slice(0, maxChars) + "\n...[摘要截断]"
      : block.content;
  return {
    ...block,
    content: truncated,
    estimatedTokens: estimateTextTokens(truncated),
  };
}

/** Factory for creating a PromptContextBlock with auto-estimated tokens */
export function createContextBlock(input: {
  id: string;
  group: string;
  priority: number;
  required?: boolean;
  content: string;
  instructionHeader?: string;
  conflictGroup?: string;
  freshness?: number;
  allowSummary?: boolean;
}): PromptContextBlock {
  return {
    id: input.id,
    group: input.group,
    priority: input.priority,
    required: input.required ?? false,
    content: input.content.trim(),
    estimatedTokens: estimateTextTokens(input.content),
    instructionHeader: input.instructionHeader,
    conflictGroup: input.conflictGroup,
    freshness: input.freshness,
    allowSummary: input.allowSummary,
  };
}
