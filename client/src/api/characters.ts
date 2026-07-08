/**
 * Character API hooks — CRUD, relationships, resources, dynamics, presence.
 * Split from api/novel.ts
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";
import { createQueryHook } from "./factory";

export interface NovelCharacter {
  id: string;
  name: string;
  role: string;
  personality?: string;
  background?: string;
  coreMotivation?: string;
  characterArc?: string;
  appearance?: string;
  quirks?: string;
  currentStatus?: string;
  currentGoal?: string;
  currentLocation?: string;
  voiceTexture?: string;
  identityLabel?: string;
  factionLabel?: string;
  prohibitions?: string;
}

export interface CharacterResourceItem { id: string; name: string; category: string; description?: string; ownerId: string; status: string; acquiredIn?: number; depletedIn?: number; }
export interface InfoProfileItem { id: string; knowerId: string; subject: string; content: string; certainty: string; }
export interface RelationshipGraph { nodes: Array<{ id: string; name: string; role: string }>; edges: Array<{ id: string; sourceId: string; targetId: string; type: string; attitudeSource: string | null; attitudeTarget: string | null; stage: string | null; sourceName: string; targetName: string }>; }

export interface CharacterPresenceRecord {
  characterId: string; characterName: string; role: string;
  volumeOrder: number; presence: "active" | "inactive" | "returning" | "departing";
  trajectoryNote: string | null;
}

export interface VolumeCastRecommendation {
  volumeOrder: number;
  activeCharacters: Array<{ characterId: string; characterName: string; role: string; reason: string }>;
  returningCharacters: Array<{ characterId: string; characterName: string; role: string; returnReason: string }>;
  departingCharacters: Array<{ characterId: string; characterName: string; role: string; departReason: string }>;
  restingCharacters: Array<{ characterId: string; characterName: string; role: string }>;
}

export interface ChapterDynamics {
  dynamics: unknown;
  contextBlock: string;
}

// ── Factory queries ─────────────────────────────────────

export const useInfoProfiles = createQueryHook<InfoProfileItem[], string>({
  queryKey: ["info-profiles"],
  url: (novelId) => `/novels/${novelId}/info-profiles`,
});

export const useRelationshipGraph = createQueryHook<RelationshipGraph, string>({
  queryKey: ["rel-graph"],
  url: (novelId) => `/novels/${novelId}/relations/graph`,
});

// ── Inline queries (multi-param / special-key) ──────────

export function useResources(novelId?: string, ownerId?: string) {
  return useQuery({ queryKey: ["resources", novelId, ownerId], queryFn: async () => { const params: Record<string,string> = {}; if (ownerId) params.ownerId = ownerId; const { data } = await api.get(`/novels/${novelId}/resources`, { params }); return data.data as CharacterResourceItem[]; }, enabled: !!novelId });
}

// Draft character relations (planning tab) — isolated query key
export function useDraftRelationshipGraph(novelId?: string) {
  return useQuery({
    queryKey: ["rel-graph", novelId, "draft"],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/relations/graph`); return data.data as RelationshipGraph; },
    enabled: !!novelId,
  });
}

export function useCharacterPresence(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["character-presence", novelId, volumeOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/characters/volume-presence/${volumeOrder}`);
      return data.data as CharacterPresenceRecord[];
    },
    enabled: !!novelId && volumeOrder !== undefined,
  });
}

export function useLongAbsentCharacters(novelId?: string, threshold = 10) {
  return useQuery({
    queryKey: ["long-absent", novelId, threshold],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/characters/long-absent?threshold=${threshold}`);
      return data.data as Array<{ characterId: string; characterName: string; chaptersSinceLastAppearance: number }>;
    },
    enabled: !!novelId,
    staleTime: 60_000,
  });
}

export function useChapterDynamics(novelId?: string, chapterId?: string) {
  return useQuery({
    queryKey: ["character-dynamics", novelId, chapterId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/character-dynamics?chapterId=${chapterId}`);
      return data.data as ChapterDynamics;
    },
    enabled: !!novelId && !!chapterId,
  });
}

// ── Inline mutations ────────────────────────────────────

export function useGenerateCharacters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/characters/generate`);
      return data.data as { characters: NovelCharacter[]; relationships: Array<{ source: string; target: string; type: string; summary: string }> };
    },
    onSuccess: (_, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: { novelId: string; ownerId: string; name: string; category: string; description?: string; acquiredIn?: number }) => { const { data } = await api.post(`/novels/${input.novelId}/resources`, input); return data.data; }, onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["resources", v.novelId] }); } });
}

export function useUpsertDraftRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; sourceCharacterId: string; targetCharacterId: string; type: string; stage?: string }) => {
      const { data } = await api.post(`/novels/${input.novelId}/relations`, input);
      return data.data;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["rel-graph", v.novelId, "draft"] }); },
  });
}

export function useUpsertRelation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: { novelId: string; sourceCharacterId: string; targetCharacterId: string; type: string; attitudeSource?: string; attitudeTarget?: string; stage?: string }) => { const { data } = await api.post(`/novels/${input.novelId}/relations`, input); return data.data; }, onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["rel-graph", v.novelId] }); } });
}

export function useVolumeCastRecommendation() {
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/character-schedule`);
      return data.data as VolumeCastRecommendation;
    },
  });
}
