/**
 * Completion Guidance — helps authors wrap up long-form novels cleanly.
 * Phase 6: Checks unresolved payoffs near the end, compares ending vs plan,
 * and triggers final volume audit.
 */
import { getPrisma } from "../../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface CompletionCheckResult {
  novelId: string;
  totalChapters: number;
  estimatedTotal: number | null;
  progressPercent: number | null;
  unresolvedPayoffs: Array<{ title: string; firstSeen: number | null; chaptersStale: number }>;
  unresolvedCount: number;
  endingComparison: {
    plannedEnding: string | null;
    actualDirection: string | null;
    needsReview: boolean;
  };
  recommendations: string[];
  readyToComplete: boolean;
}

// ─── Public API ─────────────────────────────────────────

export async function checkCompletionReadiness(novelId: string): Promise<CompletionCheckResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      estimatedChapterCount: true,
      structuredOutline: true,
      endingDirection: true,
      centralQuestion: true,
    },
  });
  if (!novel) throw new Error("Novel not found");

  const completedChapters = await prisma.chapter.count({
    where: { novelId, chapterStatus: "completed" },
  });

  const totalChapters = await prisma.chapter.count({ where: { novelId } });
  const progressPercent = novel.estimatedChapterCount
    ? Math.round(completedChapters / novel.estimatedChapterCount * 100)
    : null;

  // Check unresolved payoffs
  const unresolvedPayoffs = await prisma.payoffLedgerItem.findMany({
    where: {
      novelId,
      currentStatus: { in: ["setup", "hinted", "pending_payoff"] },
    },
    select: { title: true, firstSeenOrder: true, lastTouchedOrder: true },
  });

  const lastChapter = await prisma.chapter.findFirst({
    where: { novelId, chapterStatus: "completed" },
    orderBy: { order: "desc" },
    select: { order: true, content: true },
  });

  const currentOrder = lastChapter?.order ?? 0;
  const unresolved = unresolvedPayoffs.map(p => ({
    title: p.title,
    firstSeen: p.firstSeenOrder,
    chaptersStale: currentOrder - (p.lastTouchedOrder ?? p.firstSeenOrder ?? currentOrder),
  }));

  // Compare ending direction vs actual state
  const plannedEnding: string | null = novel.endingDirection ?? null;

  const recommendations: string[] = [];
  // Long-form: 500章的小说，80% = 400章后视为接近完本
  const isNearEnd = progressPercent !== null && progressPercent >= 80;

  // Recommendation: unresolved payoffs — 100章阈值适配长篇
  const veryStale = unresolved.filter(p => p.chaptersStale > 100);
  if (veryStale.length > 0) {
    recommendations.push(`还有${veryStale.length}条伏笔超过100章未推进：${veryStale.map(p => p.title).join("、")}。建议在后续章节集中回收或标记为废弃。`);
  }
  if (unresolved.length > 10 && isNearEnd) {
    recommendations.push(`接近完本但还有${unresolved.length}条未兑现伏笔，建议梳理回收计划。`);
  }

  // Recommendation: ending alignment
  if (isNearEnd && plannedEnding && lastChapter?.content) {
    recommendations.push(`规划结局方向为「${plannedEnding.slice(0, 60)}...」。请在最后阶段确认实际走向与规划一致。`);
  }

  // Recommendation: volume completeness — 长篇允许最后几卷未完成
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
    include: { chapterPlans: { select: { chapter: { select: { chapterStatus: true } } } } },
  });
  const incompleteVolumes = volumes.filter(v =>
    v.chapterPlans.some(cp => cp.chapter?.chapterStatus !== "completed")
  );
  if (incompleteVolumes.length > 3 && isNearEnd) {
    recommendations.push(`还有${incompleteVolumes.length}卷未完成所有章节，建议在完本前收尾。`);
  }

  // 长篇网文：允许10条以内未兑现伏笔、3卷以内未完成即可完本
  const readyToComplete = unresolved.length <= 10 && incompleteVolumes.length <= 3;

  return {
    novelId,
    totalChapters: completedChapters,
    estimatedTotal: novel.estimatedChapterCount,
    progressPercent,
    unresolvedPayoffs: unresolved,
    unresolvedCount: unresolved.length,
    endingComparison: {
      plannedEnding,
      actualDirection: lastChapter?.content?.slice(0, 200) ?? null,
      needsReview: isNearEnd,
    },
    recommendations,
    readyToComplete,
  };
}
