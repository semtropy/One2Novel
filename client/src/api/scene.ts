import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";

export interface Scene {
  id: string;
  order: number;
  title: string;
  summary: string;
  povCharacter?: string;
  participants?: string[];
  goal?: string;
  location?: string;
  timeOfDay?: string;
  estimatedWords?: number;
}

export interface ScenePlan {
  scenes: Scene[];
  scenePlanGenerated: boolean;
  generatedAt?: string;
  enabled: boolean;
}

export function useScenePlan(novelId: string, chapterId: string | undefined) {
  return useQuery({
    queryKey: ["scenePlan", novelId, chapterId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/chapters/${chapterId}/scenes`);
      return data.data as ScenePlan | null;
    },
    enabled: !!novelId && !!chapterId,
  });
}

export function useGenerateScenePlan(novelId: string, chapterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/scenes/generate`);
      return data.data as ScenePlan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenePlan", novelId, chapterId] });
    },
  });
}

export function useUpdateScenePlan(novelId: string, chapterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scenes: Scene[]) => {
      const { data } = await api.put(`/novels/${novelId}/chapters/${chapterId}/scenes`, { scenes });
      return data.data as ScenePlan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenePlan", novelId, chapterId] });
    },
  });
}

export function useToggleScenePlan(novelId: string, chapterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await api.patch(`/novels/${novelId}/chapters/${chapterId}/scenes/toggle`, { enabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenePlan", novelId, chapterId] });
    },
  });
}
