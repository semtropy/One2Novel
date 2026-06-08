/** Estimate tokens from Chinese text. ~1.5 tokens per character. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 1.5);
}

interface ContextBlock {
  text: string;
  priority: number;
  /** Optional label for per-block char limit lookup */
  label?: string;
}

interface BudgetOptions {
  maxTokens: number;
  /** Per-block character limits keyed by block label */
  blockLimits?: Record<string, number>;
  /** Drop order: labels listed here are candidates for removal when over budget (first = first to drop) */
  dropOrder?: string[];
}

/**
 * Trim context blocks to fit within a token budget.
 *
 * Strategy (ADAPTED from OP GenerationContextAssembler):
 * 1. Truncate individual blocks that exceed their per-block char limit
 * 2. Sort by priority, add blocks until near budget
 * 3. If still over budget, drop low-priority blocks per dropOrder
 */
export function selectByBudget(
  blocks: Array<ContextBlock>,
  maxTokens: number,
  opts?: Omit<BudgetOptions, "maxTokens">,
): string[] {
  const { blockLimits = {}, dropOrder = [] } = opts ?? {};

  // Step 1: Truncate individual blocks that exceed their char limit
  const truncated = blocks.map((b) => {
    const limit = b.label ? blockLimits[b.label] : undefined;
    if (limit && b.text.length > limit) {
      const trimmed = b.text.slice(0, limit);
      return { ...b, text: trimmed + "\n...[已裁剪]" };
    }
    return b;
  });

  // Step 2: Sort by priority descending, add until budget
  const sorted = [...truncated].sort((a, b) => b.priority - a.priority);
  const result: Array<ContextBlock> = [];
  let used = 0;

  for (const b of sorted) {
    const t = estimateTokens(b.text);
    if (used + t > maxTokens && result.length > 0) break;
    result.push(b);
    used += t;
  }

  // Step 3: If still over budget, drop blocks in dropOrder sequence
  if (used > maxTokens && dropOrder.length > 0) {
    for (const dropLabel of dropOrder) {
      if (used <= maxTokens) break;
      const idx = result.findIndex((b) => b.label === dropLabel);
      if (idx >= 0) {
        used -= estimateTokens(result[idx].text);
        result.splice(idx, 1);
      }
    }
  }

  return result.map((b) => b.text);
}
