/**
 * Cost Tracker — records LLM token usage per call and provides budget management.
 * Phase 5: Tracks input/output tokens, estimates cost, enforces budget limits.
 */
import { getPrisma } from "../../../platform/db/client";

// ─── Pricing (USD per 1M tokens) ──────────────────────

const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  deepseek: { input: 0.27, output: 1.10 },
  openai: { input: 2.50, output: 10.00 },
  anthropic: { input: 3.00, output: 15.00 },
  gemini: { input: 1.25, output: 5.00 },
};

// ─── Types ─────────────────────────────────────────────

export interface CostRecord {
  novelId: string;
  chapterId?: string;
  assetId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  provider: string;
  model?: string;
}

export interface CostSummary {
  novelId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  estimatedRemainingCost: number | null;
  averageCostPerChapter: number;
  chapterCount: number;
  budgetLimit: number | null;
  budgetPercent: number | null;
  warning: string | null;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Record a single LLM call's token usage.
 * Called from the LLM infrastructure layer after each API call.
 */
export async function recordCost(input: Omit<CostRecord, "estimatedCost">): Promise<void> {
  const pricing = PROVIDER_PRICING[input.provider] ?? PROVIDER_PRICING.deepseek;
  const estimatedCost =
    (input.inputTokens / 1_000_000) * pricing.input +
    (input.outputTokens / 1_000_000) * pricing.output;

  const prisma = getPrisma();
  try {
    await prisma.costRecord.create({
      data: {
        novelId: input.novelId,
        chapterId: input.chapterId ?? "",
        assetId: input.assetId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
        provider: input.provider,
        model: input.model,
      },
    });
  } catch { /* Best-effort — don't block the main flow */ }
}

/**
 * Get cost summary for a novel.
 */
export async function getCostSummary(novelId: string): Promise<CostSummary> {
  const prisma = getPrisma();

  const [records, novel] = await Promise.all([
    prisma.costRecord.findMany({
      where: { novelId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.novel.findUnique({
      where: { id: novelId },
      select: { estimatedChapterCount: true },
    }),
  ]);

  const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
  const totalEstimatedCost = records.reduce((s, r) => s + (r.estimatedCost ?? 0), 0);

  // Count distinct chapters with completed status
  const completedChapters = await prisma.chapter.count({
    where: { novelId, chapterStatus: "completed" },
  });

  const averageCostPerChapter = completedChapters > 0
    ? totalEstimatedCost / completedChapters
    : 0;

  // Budget limit (stored in preferences for now, can be moved to Novel table)
  const budgetLimit = await getBudgetLimit(novelId);
  const estimatedRemainingCost = novel?.estimatedChapterCount && completedChapters > 0
    ? averageCostPerChapter * (novel.estimatedChapterCount - completedChapters)
    : null;

  const budgetPercent = budgetLimit ? (totalEstimatedCost / budgetLimit) * 100 : null;

  let warning: string | null = null;
  if (budgetLimit && totalEstimatedCost >= budgetLimit * 0.9) {
    warning = budgetLimit > 0 && totalEstimatedCost >= budgetLimit
      ? `已达到预算上限 ¥${budgetLimit.toFixed(2)}`
      : `已接近预算上限（${budgetPercent?.toFixed(0)}%），达到后将自动暂停`;
  }

  return {
    novelId,
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
    estimatedRemainingCost: estimatedRemainingCost ? Math.round(estimatedRemainingCost * 100) / 100 : null,
    averageCostPerChapter: Math.round(averageCostPerChapter * 10000) / 10000,
    chapterCount: completedChapters,
    budgetLimit,
    budgetPercent: budgetPercent ? Math.round(budgetPercent * 10) / 10 : null,
    warning,
  };
}

// ─── Budget Management ─────────────────────────────────

/** Read budget limit from the Novel record (persisted across restarts) */
async function getBudgetLimit(novelId: string): Promise<number | null> {
  try {
    const novel = await getPrisma().novel.findUnique({
      where: { id: novelId },
      select: { budgetLimit: true },
    });
    return novel?.budgetLimit ?? null;
  } catch {
    return null;
  }
}

/** Persist budget limit to the Novel record */
export async function setBudgetLimit(novelId: string, limit: number | null): Promise<void> {
  await getPrisma().novel.update({
    where: { id: novelId },
    data: { budgetLimit: limit },
  });
}

/**
 * Check if writing should pause due to budget.
 * Returns a warning message if near/over budget, null if fine.
 */
export async function checkBudget(novelId: string): Promise<string | null> {
  const summary = await getCostSummary(novelId);
  if (summary.warning) return summary.warning;
  return null;
}
