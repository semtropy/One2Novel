/**
 * Chapter API hooks — optimize, cleanup, formatting issues.
 * Split from api/novel.ts
 */
import { createQueryHook, createMutationHook } from "./factory";

export interface FormattingIssue { type: string; severity: string; description: string; count: number; }
export interface CleanupResult { chapterId: string; issuesFixed: string[]; charsBefore: number; charsAfter: number; }
export interface OptimizeResult {
  optimizedContent: string;
  changesSummary: string;
  preservedElements: string[];
}

type NovelChapterInput = { novelId: string; chapterId: string };

export const useOptimizeChapter = createMutationHook<NovelChapterInput, OptimizeResult>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/chapters/${input.chapterId}/optimize`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useCleanupChapter = createMutationHook<NovelChapterInput, CleanupResult>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/chapters/${input.chapterId}/cleanup`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useCleanupAllChapters = createMutationHook<string, CleanupResult[]>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/cleanup`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});

export const useFormattingIssues = createQueryHook<FormattingIssue[], { novelId: string; chapterId: string }>({
  queryKey: ["format-issues"],
  url: (p) => `/novels/${p.novelId}/chapters/${p.chapterId}/format-issues`,
  enabled: (p) => !!p.novelId && !!p.chapterId,
});
