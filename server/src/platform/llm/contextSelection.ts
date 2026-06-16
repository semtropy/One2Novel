import type { ContextPolicy, PromptContextBlock } from "./promptTypes";

export interface ContextSelectionResult {
  selectedBlocks: PromptContextBlock[];
  droppedBlockIds: string[];
  summarizedBlockIds: string[];
  estimatedTokens: number;
}

/**
 * Select context blocks: deduplicate by conflictGroup, sort by priority,
 * and return ALL blocks (no token budget trimming).
 * Quality over token savings — modern models have large context windows.
 */
export function selectContextBlocks(blocks: PromptContextBlock[], _policy: ContextPolicy): ContextSelectionResult {
  const normalizedBlocks = blocks.filter((block) => block.content.trim().length > 0 && block.estimatedTokens > 0);
  const deduped = dedupeConflictBlocks(normalizedBlocks);

  const selectedBlocks = deduped.kept.sort((a, b) => b.priority - a.priority);
  const estimatedTokens = selectedBlocks.reduce((sum, b) => sum + b.estimatedTokens, 0);

  return {
    selectedBlocks,
    droppedBlockIds: deduped.droppedIds,
    summarizedBlockIds: [],
    estimatedTokens,
  };
}

/**
 * Within each conflictGroup, keep the most recent version and drop the older one.
 */
function dedupeConflictBlocks(blocks: PromptContextBlock[]): { kept: PromptContextBlock[]; droppedIds: string[] } {
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

    // Keep the higher-priority or more-recent (higher freshness) block
    const prevFreshness = previous.freshness ?? 0;
    const nextFreshness = block.freshness ?? 0;
    const shouldReplace = nextFreshness > prevFreshness
      || (nextFreshness === prevFreshness && block.priority > previous.priority)
      || (nextFreshness === prevFreshness && block.priority === previous.priority && block.required && !previous.required);

    if (shouldReplace) {
      droppedIds.push(previous.id);
      byConflictGroup.set(block.conflictGroup, { ...block, required: block.required || previous.required });
    } else {
      if (block.required && !previous.required) {
        byConflictGroup.set(block.conflictGroup, { ...previous, required: true });
      }
      droppedIds.push(block.id);
    }
  }

  return { kept: [...kept, ...byConflictGroup.values()], droppedIds };
}
