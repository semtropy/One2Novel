/**
 * Novel API — core CRUD hooks + re-exports from domain-specific files.
 *
 * Domain hooks live in:
 *   api/world.ts        api/characters.ts    api/statistics.ts
 *   api/rhythm.ts       api/volumes.ts       api/chapters.ts
 *   api/story-core.ts   api/timeline.ts      api/export.ts
 *   api/architecture.ts
 *
 * All hooks are re-exported here for backward compatibility.
 * New consumers should import directly from domain files.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";
import type { NovelDetail, NovelCreate, NovelUpdate } from "@one2novel/shared/types/novel";
import { createQueryHook, createMutationHook } from "./factory";

// ── Architecture re-exports ──────────────────────────────
export { useArchitectureTemplates, useGenerateLoopSkeleton, useLoopSkeleton, useExpandLoopToVolume, useGenerateNextVolume, useSaveArchitecture } from "./architecture";
export type { ArchitectureTemplateSummary, LoopSkeletonItem, LoopSkeleton, ExpandedChapter, ExpandedVolume } from "./architecture";

// ── Domain re-exports ────────────────────────────────────
export { useWorldRules, useCreateWorldRule, useUpdateWorldRule, useDeleteWorldRule, useCheckWorldConflicts, useResolveWorldConflict, useGenerateWorldRules } from "./world";
export type { WorldRule, ConflictResult } from "./world";

export { useInfoProfiles, useRelationshipGraph, useResources, useCreateResource, useDraftRelationshipGraph, useUpsertDraftRelation, useUpsertRelation, useGenerateCharacters, useCharacterPresence, useVolumeCastRecommendation, useLongAbsentCharacters, useChapterDynamics } from "./characters";
export type { NovelCharacter, CharacterResourceItem, InfoProfileItem, RelationshipGraph, CharacterPresenceRecord, VolumeCastRecommendation, ChapterDynamics } from "./characters";

export { useNovelStatistics, useQualityTrend, usePayoffStats, useDailyOutput } from "./statistics";
export type { WritingStats, DailyOutput, QualityTrend, PayoffStats } from "./statistics";

export { useCoolPointStatus, useHookCheck, useHookDensity, useVolumeRhythmReport } from "./rhythm";
export type { CoolPointStatus, HookCheckResult, HookDensityReport, VolumeRhythmReport } from "./rhythm";

export { useRebalanceVolume, useCrossVolumeAudit, useCompressVolume } from "./volumes";
export type { VolumeCompressionResult, AuditFinding, CrossVolumeAuditReport, RebalanceResult } from "./volumes";

export { useOptimizeChapter, useCleanupChapter, useCleanupAllChapters, useFormattingIssues } from "./chapters";
export type { FormattingIssue, CleanupResult, OptimizeResult } from "./chapters";

export { useGenerateFraming, useGenerateStoryCore, useGenerateGoldenFinger } from "./story-core";
export type { BookFramingResult, StoryCoreResult, GoldenFingerResult } from "./story-core";

export { useTimelineReminders } from "./timeline";
export type { ChapterReminder, ChapterRemindersResult } from "./timeline";

export { useExportPreview, useExportNovel } from "./export";
export type { ExportPreview } from "./export";

// ── Shared type aliases ──────────────────────────────────
export type Novel = NovelDetail;
export type { NovelCreate, NovelUpdate };

// ── Reference book ──────────────────────────────────────

export const useExtractWritingAssets = createMutationHook<string, unknown>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/reference-book/extract-writing-assets`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});

// Kept inline: dual invalidation (["novel", ...] + ["style-profiles"])
export function useCreateStyleProfileFromAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/reference-book/create-style-profile`);
      return data.data as { profileId: string; bindingId: string };
    },
    onSuccess: (_data, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
      qc.invalidateQueries({ queryKey: ["style-profiles"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// Core novel hooks (kept here — unique to novel aggregate)
// ═══════════════════════════════════════════════════════════

export function useNovels() {
  return useQuery({
    queryKey: ["novels"],
    queryFn: async () => {
      const { data } = await api.get("/novels");
      return data.data as Novel[];
    },
  });
}

export function useNovel(id: string | undefined) {
  return useQuery({
    queryKey: ["novel", id],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${id}`);
      return data.data as NovelDetail;
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useCreateNovel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; genre?: string; description?: string }) => {
      const { data } = await api.post("/novels", input);
      return data.data as Novel;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["novels"] }); },
  });
}

export function useUpdateNovel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; [key: string]: unknown }) => {
      const { data } = await api.patch(`/novels/${id}`, body);
      return data.data as Novel;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["novel", id] });
    },
  });
}

export const useCompletionReadiness = createQueryHook<CompletionReadiness, string>({
  queryKey: ["completion-readiness"],
  url: (novelId) => `/novels/${novelId}/completion-readiness`,
  staleTime: 30_000,
});

export interface CompletionReadiness {
  totalChapters: number;
  estimatedTotal: number | null;
  progressPercent: number | null;
  unresolvedCount: number;
  unresolvedPayoffs: Array<{ title: string; firstSeen: number | null; chaptersStale: number }>;
  endingComparison: { plannedEnding: string | null; actualDirection: string | null; needsReview: boolean };
  recommendations: string[];
  readyToComplete: boolean;
}
