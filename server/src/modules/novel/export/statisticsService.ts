/**
 * Statistics Service — computes writing stats from existing DB data.
 * Read-only, no LLM calls.
 */

import { getPrisma } from "../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface WritingStats {
  totalChars: number;
  totalChapters: number;
  completedChapters: number;
  draftedChapters: number;
  avgCharsPerChapter: number;
  avgQualityScore: number;
  payoffSetupCount: number;
  payoffPaidCount: number;
  payoffCompletionRate: number;
  totalCharacters: number;
  estimatedReadingMinutes: number;
}

export interface DailyOutput {
  date: string;
  chars: number;
  chapters: number;
}

export interface QualityTrend {
  chapterOrder: number;
  title: string;
  totalScore: number;
  breakdown: Record<string, number>;
}

export interface PayoffStats {
  total: number;
  setup: number;
  hinted: number;
  pendingPayoff: number;
  paidOff: number;
  failed: number;
  overdue: number;
  completionRate: number;
}

// ─── Main stats ────────────────────────────────────────

export async function getNovelStatistics(novelId: string): Promise<WritingStats> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { chapters: true },
  });
  if (!novel) throw new Error("Novel not found");

  let totalChars = 0;
  let totalQuality = 0;
  let scoredChapters = 0;
  let completedChapters = 0;
  let draftedChapters = 0;

  for (const ch of novel.chapters) {
    const chars = (ch.content ?? "").replace(/<[^>]*>/g, "").length;
    totalChars += chars;
    if (ch.qualityScore != null) {
      totalQuality += ch.qualityScore;
      scoredChapters++;
    }
    if (ch.chapterStatus === "completed") completedChapters++;
    if (ch.chapterStatus === "drafted" || ch.chapterStatus === "completed") draftedChapters++;
  }

  const payoffStats = await getPayoffStats(novelId);
  const chars = await prisma.novelCharacter.count({ where: { novelId } });

  return {
    totalChars,
    totalChapters: novel.chapters.length,
    completedChapters,
    draftedChapters,
    avgCharsPerChapter: novel.chapters.length > 0 ? Math.round(totalChars / novel.chapters.length) : 0,
    avgQualityScore: scoredChapters > 0 ? Math.round(totalQuality / scoredChapters * 10) / 10 : 0,
    payoffSetupCount: payoffStats.setup + payoffStats.hinted + payoffStats.pendingPayoff,
    payoffPaidCount: payoffStats.paidOff,
    payoffCompletionRate: payoffStats.completionRate,
    totalCharacters: chars,
    estimatedReadingMinutes: Math.round(totalChars / 500),
  };
}

// ─── Daily output ──────────────────────────────────────

export async function getDailyOutput(novelId: string, days = 30): Promise<DailyOutput[]> {
  const prisma = getPrisma();
  const chapters = await prisma.chapter.findMany({
    where: { novelId, content: { not: null } },
    orderBy: { updatedAt: "asc" },
    select: { content: true, updatedAt: true },
  });

  const dailyMap = new Map<string, { chars: number; chapters: number }>();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  for (const ch of chapters) {
    const date = ch.updatedAt.toISOString().split("T")[0];
    if (ch.updatedAt < cutoff) continue;

    const prev = dailyMap.get(date) ?? { chars: 0, chapters: 0 };
    prev.chars += (ch.content ?? "").replace(/<[^>]*>/g, "").length;
    prev.chapters += 1;
    dailyMap.set(date, prev);
  }

  return Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Quality trend ─────────────────────────────────────

export async function getQualityTrend(novelId: string): Promise<QualityTrend[]> {
  const prisma = getPrisma();
  const chapters = await prisma.chapter.findMany({
    where: { novelId, qualityScore: { not: null } },
    orderBy: { order: "asc" },
    select: {
      order: true, title: true, qualityScore: true,
      openingScore: true, plotScore: true, characterScore: true,
      dialogueScore: true, suspenseScore: true, pacingScore: true,
      languageScore: true, genreScore: true,
    },
  });

  return chapters.map(ch => ({
    chapterOrder: ch.order,
    title: ch.title,
    totalScore: ch.qualityScore ?? 0,
    breakdown: {
      opening: ch.openingScore ?? 0,
      plot: ch.plotScore ?? 0,
      character: ch.characterScore ?? 0,
      dialogue: ch.dialogueScore ?? 0,
      suspense: ch.suspenseScore ?? 0,
      pacing: ch.pacingScore ?? 0,
      language: ch.languageScore ?? 0,
      genre: ch.genreScore ?? 0,
    },
  }));
}

// ─── Payoff stats ──────────────────────────────────────

export async function getPayoffStats(novelId: string): Promise<PayoffStats> {
  const prisma = getPrisma();
  const items = await prisma.payoffLedgerItem.findMany({
    where: { novelId },
    select: { currentStatus: true },
  });

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.currentStatus] = (counts[item.currentStatus] ?? 0) + 1;
  }

  const total = items.length;
  const paidOff = counts["paid_off"] ?? 0;

  return {
    total,
    setup: counts["setup"] ?? 0,
    hinted: counts["hinted"] ?? 0,
    pendingPayoff: counts["pending_payoff"] ?? 0,
    paidOff,
    failed: counts["failed"] ?? 0,
    overdue: counts["overdue"] ?? 0,
    completionRate: total > 0 ? Math.round(paidOff / total * 100) : 0,
  };
}
