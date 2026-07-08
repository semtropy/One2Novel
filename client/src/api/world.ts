/**
 * World Rules API hooks — CRUD + conflict detection + AI generation.
 * Split from api/novel.ts
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";
import { createMutationHook } from "./factory";

export interface WorldRule {
  id: string; novelId: string; category: string; title: string;
  content: string; priority: number; status: string;
}
export interface ConflictResult {
  ruleId: string; title: string;
  conflicts: Array<{ ruleId: string; title: string; explanation: string }>;
}

// Kept inline: multi-param query with optional category filter
export function useWorldRules(novelId?: string, category?: string) {
  return useQuery({
    queryKey: ["world-rules", novelId, category],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (category) params.category = category;
      const { data } = await api.get(`/novels/${novelId}/world/rules`, { params });
      return data.data as WorldRule[];
    },
    enabled: !!novelId,
  });
}

// Kept inline: complex body shape not expressible via factory
export function useCreateWorldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; category: string; title: string; content: string; priority?: number }) => {
      const { data } = await api.post(`/novels/${input.novelId}/world/rules`, { category: input.category, title: input.title, content: input.content, priority: input.priority });
      return data.data as WorldRule;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["world-rules", v.novelId] }); },
  });
}

// Kept inline: complex partial-update body
export function useUpdateWorldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; ruleId: string; title?: string; content?: string; category?: string; priority?: number; status?: string }) => {
      const { data } = await api.patch(`/novels/${input.novelId}/world/rules/${input.ruleId}`, { title: input.title, content: input.content, category: input.category, priority: input.priority, status: input.status });
      return data.data as WorldRule;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["world-rules", v.novelId] }); },
  });
}

// Kept inline: void return (factory expects data.data)
export function useDeleteWorldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; ruleId: string }) => {
      await api.delete(`/novels/${input.novelId}/world/rules/${input.ruleId}`);
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["world-rules", v.novelId] }); },
  });
}

// Kept inline: no-invalidation mutation
export function useCheckWorldConflicts() {
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/world/rules/check-conflicts`);
      return data.data as ConflictResult[];
    },
  });
}

// Kept inline: complex resolution body
export function useResolveWorldConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; ruleId: string; resolution: "keep" | "deprecate" }) => {
      const { data } = await api.post(`/novels/${input.novelId}/world/rules/${input.ruleId}/resolve-conflict`, { resolution: input.resolution });
      return data.data as WorldRule;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["world-rules", v.novelId] }); },
  });
}

// Factory: standard POST with no-body + invalidation
export const useGenerateWorldRules = createMutationHook<string, WorldRule[]>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/world/rules/generate`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["world-rules", novelId]],
});
