/**
 * Timeline API hooks — reminders for the current chapter.
 * Split from api/novel.ts
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../app/api";

export interface ChapterReminder {
  title: string; category: string; sortOrder: number;
  status: string; isOverdue: boolean; isUpcoming: boolean;
}

export interface ChapterRemindersResult {
  reminders: ChapterReminder[]; summary: string;
}

// Kept inline: multi-param enabled guard + staleTime
export function useTimelineReminders(novelId?: string, chapterOrder?: number) {
  return useQuery({
    queryKey: ["timeline-reminders", novelId, chapterOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/timeline/reminders/${chapterOrder}`);
      return data.data as ChapterRemindersResult;
    },
    enabled: !!novelId && chapterOrder !== undefined && chapterOrder > 0,
    staleTime: 30_000,
  });
}
