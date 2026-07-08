/**
 * Statistics API hooks — writing stats, quality trends, payoff stats, daily output.
 * Split from api/novel.ts
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../app/api";
import { createQueryHook } from "./factory";

export interface WritingStats {
  totalChars: number; totalChapters: number; completedChapters: number;
  draftedChapters: number; avgCharsPerChapter: number; avgQualityScore: number;
  payoffSetupCount: number; payoffPaidCount: number; payoffCompletionRate: number;
  totalCharacters: number; estimatedReadingMinutes: number;
}

export interface DailyOutput { date: string; chars: number; chapters: number; }
export interface QualityTrend { chapterOrder: number; title: string; totalScore: number; breakdown: Record<string, number>; }
export interface PayoffStats { total: number; setup: number; hinted: number; pendingPayoff: number; paidOff: number; failed: number; overdue: number; completionRate: number; }

export const useNovelStatistics = createQueryHook<WritingStats, string>({
  queryKey: ["statistics"],
  url: (novelId) => `/novels/${novelId}/statistics`,
});

export const useQualityTrend = createQueryHook<QualityTrend[], string>({
  queryKey: ["quality-trend"],
  url: (novelId) => `/novels/${novelId}/statistics/quality`,
});

export const usePayoffStats = createQueryHook<PayoffStats, string>({
  queryKey: ["payoff-stats"],
  url: (novelId) => `/novels/${novelId}/statistics/payoffs`,
});

// Kept inline: extra `days` param not supported by factory
export function useDailyOutput(novelId?: string, days = 30) {
  return useQuery({
    queryKey: ["daily-output", novelId, days],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/statistics/daily`, { params: { days } }); return data.data as DailyOutput[]; },
    enabled: !!novelId,
  });
}
