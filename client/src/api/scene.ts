import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
}

async function fetchScenePlan(novelId: string, chapterId: string): Promise<ScenePlan | null> {
  const res = await fetch(`/api/novels/${novelId}/chapters/${chapterId}/scenes`);
  if (!res.ok) throw new Error("获取分镜失败");
  const json = await res.json();
  return json.data ?? null;
}

async function generateScenePlan(novelId: string, chapterId: string): Promise<ScenePlan> {
  const res = await fetch(`/api/novels/${novelId}/chapters/${chapterId}/scenes/generate`, { method: "POST" });
  if (!res.ok) throw new Error("生成分镜失败");
  const json = await res.json();
  return json.data;
}

async function updateScenePlan(novelId: string, chapterId: string, scenes: Scene[]): Promise<ScenePlan> {
  const res = await fetch(`/api/novels/${novelId}/chapters/${chapterId}/scenes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenes }),
  });
  if (!res.ok) throw new Error("保存分镜失败");
  const json = await res.json();
  return json.data;
}

export function useScenePlan(novelId: string, chapterId: string | undefined) {
  return useQuery({
    queryKey: ["scenePlan", novelId, chapterId],
    queryFn: () => fetchScenePlan(novelId!, chapterId!),
    enabled: !!novelId && !!chapterId,
  });
}

export function useGenerateScenePlan(novelId: string, chapterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => generateScenePlan(novelId!, chapterId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenePlan", novelId, chapterId] });
    },
  });
}

export function useUpdateScenePlan(novelId: string, chapterId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scenes: Scene[]) => updateScenePlan(novelId!, chapterId!, scenes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenePlan", novelId, chapterId] });
    },
  });
}
