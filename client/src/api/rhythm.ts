/**
 * Rhythm & Cool Points API hooks.
 * Split from api/novel.ts
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../app/api";

export interface CoolPointStatus {
  volumeOrder: number; chaptersWritten: number;
  breakdown: Array<{ type: string; target: number; actual: number; percentage: number; gap: string }>;
  alerts: Array<{ type: string; severity: string; message: string; chaptersSince: number }>;
}

export interface HookCheckResult {
  chapterId: string; chapterOrder: number;
  hasHook: boolean; hookQuality: "strong" | "adequate" | "weak" | "missing";
  issue?: string;
}

export interface HookDensityReport {
  volumeOrder: number; totalChapters: number;
  chaptersWithHooks: number; chaptersWithoutHooks: number;
  weakHookChapters: number[]; density: number;
  verdict: "good" | "acceptable" | "needs_improvement";
  suggestion: string;
}

export interface VolumeRhythmReport {
  volumeOrder: number; passed: boolean;
  violations: Array<{ severity: string; category: string; location: string; description: string; suggestion: string }>;
  summary: string;
}

// All kept inline — multi-param queries with special staleTime configs

export function useCoolPointStatus(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["coolpoint-status", novelId, volumeOrder],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/coolpoint-status`); return data.data as CoolPointStatus; },
    enabled: !!novelId && volumeOrder !== undefined, staleTime: 30_000,
  });
}

export function useHookCheck(novelId?: string, chapterId?: string) {
  return useQuery({
    queryKey: ["hook-check", novelId, chapterId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/chapters/${chapterId}/hook-check`); return data.data as HookCheckResult; },
    enabled: !!novelId && !!chapterId, staleTime: 60_000,
  });
}

export function useHookDensity(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["hook-density", novelId, volumeOrder],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/hook-density`); return data.data as HookDensityReport; },
    enabled: !!novelId && volumeOrder !== undefined, staleTime: 60_000,
  });
}

export function useVolumeRhythmReport(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["rhythm-report", novelId, volumeOrder],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/rhythm-report`); return data.data as VolumeRhythmReport; },
    enabled: !!novelId && volumeOrder !== undefined,
  });
}
