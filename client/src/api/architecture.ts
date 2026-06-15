/** Phase 1: Architecture templates, loop skeleton, volume expansion */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";

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

export function useGenerateLoopSkeleton() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, architectureType, totalLoops }: {
      novelId: string; architectureType: string; totalLoops?: number;
    }) => {
      const { data } = await api.post(`/novels/${novelId}/loops/generate-skeleton`, { architectureType, totalLoops });
      return data.data as LoopSkeleton;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

export function useLoopSkeleton(novelId?: string) {
  return useQuery({
    queryKey: ["loop-skeleton", novelId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/loops`);
      return data.data as LoopSkeleton | null;
    },
    enabled: !!novelId,
  });
}

export function useExpandLoopToVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/expand`);
      return data.data as ExpandedVolume;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

export function useGenerateNextVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/generate-next`);
      return data.data as ExpandedVolume;
    },
    onSuccess: (_, novelId) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

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
