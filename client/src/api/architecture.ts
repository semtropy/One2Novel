/** Phase 1: Architecture templates, loop skeleton, volume expansion */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";
import { createQueryHook, createMutationHook } from "./factory";

export interface ArchitectureTemplateSummary {
  id: string; name: string; description: string;
  compatibleGenres: string[]; defaultLoop: unknown; representativeWorks: string[];
}

export interface LoopSkeletonItem {
  loopIndex: number; triggerEvent: string; dungeonName: string;
  estimatedChapters: number; settlementContent: string; scaleUpDirection: string;
}

export interface LoopSkeleton {
  architectureType: string; totalLoops: number;
  loops: LoopSkeletonItem[]; estimatedTotalChapters: number;
}

export interface ExpandedChapter {
  chapterOrder: number; title: string; summary: string;
  loopPhase: string; coolPointType?: string; hookType?: string;
  chapterType: string; expectation: string; coreEvent: string; endingHook: string;
}

export interface ExpandedVolume {
  sortOrder: number; title: string; summary: string; loopIndex: number;
  phases: Array<{ phase: string; label: string; chapters: ExpandedChapter[] }>;
  totalChapters: number;
}

// Special case: long staleTime (10 min) — kept inline
export function useArchitectureTemplates(novelId?: string) {
  return useQuery({
    queryKey: ["architecture-templates", novelId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/architecture/templates`);
      return data.data as ArchitectureTemplateSummary[];
    },
    enabled: !!novelId, staleTime: 600_000,
  });
}

export const useGenerateLoopSkeleton = createMutationHook<
  { novelId: string; architectureType: string; totalLoops?: number },
  LoopSkeleton
>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/loops/generate-skeleton`,
  body: (input) => ({ architectureType: input.architectureType, totalLoops: input.totalLoops }),
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useLoopSkeleton = createQueryHook<LoopSkeleton | null, string>({
  queryKey: ["loop-skeleton"],
  url: (novelId) => `/novels/${novelId}/loops`,
});

export const useExpandLoopToVolume = createMutationHook<
  { novelId: string; sortOrder: number },
  ExpandedVolume
>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/volumes/${input.sortOrder}/expand`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useGenerateNextVolume = createMutationHook<string, ExpandedVolume>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/volumes/generate-next`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});

// Kept inline: api.put with void return + complex input type
export function useSaveArchitecture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      novelId: string; architectureType?: string; loopDefinition?: unknown;
      goldenFingerAbilities?: string[]; goldenFingerLimits?: string[];
      goldenFinger?: string; centralQuestion?: string; endingDirection?: string;
    }) => {
      await api.put(`/novels/${input.novelId}/architecture`, input);
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}
