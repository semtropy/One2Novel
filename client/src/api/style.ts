import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";

export interface StyleProfile {
  id: string;
  name: string;
  sourceText?: string;
  extractedFeatures?: string;
  narrativeRules?: string;
  languageRules?: string;
  characterRules?: string;
  rhythmRules?: string;
  antiAiRules?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export function useStyleProfiles() {
  return useQuery({
    queryKey: ["styles"],
    queryFn: async () => { const { data } = await api.get("/styles"); return data.data as StyleProfile[]; },
  });
}

export function useCreateStyleProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; sourceText?: string }) => {
      const { data } = await api.post("/styles", input);
      return data.data as StyleProfile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["styles"] }),
  });
}

export function useExtractStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { data } = await api.post(`/styles/${profileId}/extract`);
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["styles"] }),
  });
}

export function useBindStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, targetType, targetId }: { profileId: string; targetType: string; targetId: string }) => {
      const { data } = await api.post(`/styles/${profileId}/bind`, { targetType, targetId });
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["styles"] }),
  });
}
