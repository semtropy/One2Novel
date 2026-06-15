import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";
import type { NovelDetail, NovelCreate, NovelUpdate } from "@one2novel/shared/types/novel";

// Phase 1-4 hooks are defined in domain-specific files, re-exported here for backward compatibility
export { useArchitectureTemplates, useGenerateLoopSkeleton, useLoopSkeleton, useExpandLoopToVolume, useGenerateNextVolume, useSaveArchitecture } from "./architecture";
export type { ArchitectureTemplateSummary, LoopSkeletonItem, LoopSkeleton, ExpandedChapter, ExpandedVolume } from "./architecture";

// Re-export shared types so consumers don't need direct shared imports
export type Novel = NovelDetail;
export type { NovelCreate, NovelUpdate };

export interface BookFramingResult {
  targetAudience: string;
  commercialTags: string[];
  competingFeel: string;
  bookSellingPoint: string;
  first30ChapterPromise: string;
}

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

export interface NovelCharacter {
  id: string;
  name: string;
  role: string;
  personality?: string;
  background?: string;
  development?: string;
  appearance?: string;
  currentGoal?: string;
  voiceTexture?: string;
  identityLabel?: string;
  factionLabel?: string;
  prohibitions?: string;
}

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

export function useGenerateFraming() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/framing`);
      return data.data as BookFramingResult;
    },
    onSuccess: (_, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
  });
}

// ─── Story Core ─────────────────────────────────────────

export interface StoryCoreResult {
  storySummary: string; centralQuestion: string; endingDirection: string;
  genre: string | null; narrativePov: string | null; pacePreference: string | null;
  styleTone: string | null; emotionIntensity: string | null;
}

export function useGenerateStoryCore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/story-core`);
      return data.data as StoryCoreResult;
    },
    onSuccess: (_, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
  });
}

// ─── Blueprint ──────────────────────────────────────────

export interface BlueprintResult {
  volumes: Array<{
    sortOrder: number; title: string; summary: string;
    chapters: Array<{
      order: number; title: string; summary: string;
      coreEvent: string; hook: string; characters: string[];
      conflictLevel: number; revealLevel: number;
    }>;
  }>;
}

export function useGenerateBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/blueprint`);
      return data.data as BlueprintResult;
    },
    onSuccess: (_, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
  });
}

// ─── Confirmation removed — planning writes directly to production tables ───

// ─── Phase 13: Export / Statistics / Cleanup ───────────

export interface ExportPreview {
  title: string; genre: string | null;
  chapterCount: number; totalChars: number; completedChapters: number;
}

export interface WritingStats {
  totalChars: number; totalChapters: number; completedChapters: number;
  draftedChapters: number; avgCharsPerChapter: number; avgQualityScore: number;
  payoffSetupCount: number; payoffPaidCount: number; payoffCompletionRate: number;
  totalCharacters: number; estimatedReadingMinutes: number;
}

export interface DailyOutput { date: string; chars: number; chapters: number; }
export interface QualityTrend { chapterOrder: number; title: string; totalScore: number; breakdown: Record<string, number>; }
export interface PayoffStats { total: number; setup: number; hinted: number; pendingPayoff: number; paidOff: number; failed: number; overdue: number; completionRate: number; }
export interface FormattingIssue { type: string; severity: string; description: string; count: number; }
export interface CleanupResult { chapterId: string; issuesFixed: string[]; charsBefore: number; charsAfter: number; }

export function useExportPreview(novelId?: string) {
  return useQuery({
    queryKey: ["export-preview", novelId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/export/preview`); return data.data as ExportPreview; },
    enabled: !!novelId,
  });
}

export function useExportNovel() {
  return useMutation({
    mutationFn: async ({ novelId, format }: { novelId: string; format: string }) => {
      const response = await api.get(`/novels/${novelId}/export`, { params: { format }, responseType: "blob" });
      return response.data;
    },
  });
}

export function useNovelStatistics(novelId?: string) {
  return useQuery({
    queryKey: ["statistics", novelId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/statistics`); return data.data as WritingStats; },
    enabled: !!novelId,
  });
}

export function useDailyOutput(novelId?: string, days = 30) {
  return useQuery({
    queryKey: ["daily-output", novelId, days],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/statistics/daily`, { params: { days } }); return data.data as DailyOutput[]; },
    enabled: !!novelId,
  });
}

export function useQualityTrend(novelId?: string) {
  return useQuery({
    queryKey: ["quality-trend", novelId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/statistics/quality`); return data.data as QualityTrend[]; },
    enabled: !!novelId,
  });
}

export function usePayoffStats(novelId?: string) {
  return useQuery({
    queryKey: ["payoff-stats", novelId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/statistics/payoffs`); return data.data as PayoffStats; },
    enabled: !!novelId,
  });
}

export function useFormattingIssues(novelId?: string, chapterId?: string) {
  return useQuery({
    queryKey: ["format-issues", novelId, chapterId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/chapters/${chapterId}/format-issues`); return data.data as FormattingIssue[]; },
    enabled: !!novelId && !!chapterId,
  });
}

export function useCleanupChapter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, chapterId }: { novelId: string; chapterId: string }) => {
      const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/cleanup`);
      return data.data as CleanupResult;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

export function useCleanupAllChapters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/cleanup`);
      return data.data as CleanupResult[];
    },
    onSuccess: (_, novelId) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

// ─── Phase 11: World Rules ─────────────────────────────

export interface WorldRule {
  id: string; novelId: string; category: string; title: string;
  content: string; priority: number; status: string;
}
export interface ConflictResult {
  ruleId: string; title: string;
  conflicts: Array<{ ruleId: string; title: string; explanation: string }>;
}

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

export function useDeleteWorldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; ruleId: string }) => {
      await api.delete(`/novels/${input.novelId}/world/rules/${input.ruleId}`);
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["world-rules", v.novelId] }); },
  });
}

export function useGenerateWorldRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/world/rules/generate`);
      return data.data as WorldRule[];
    },
    onSuccess: (_, novelId) => { qc.invalidateQueries({ queryKey: ["world-rules", novelId] }); },
  });
}

export function useCheckWorldConflicts() {
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/world/rules/check-conflicts`);
      return data.data as ConflictResult[];
    },
  });
}

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

// ─── Phase 12: Character Depth ─────────────────────────

export interface CharacterResourceItem { id: string; name: string; category: string; description?: string; ownerId: string; status: string; acquiredIn?: number; depletedIn?: number; }
export interface InfoProfileItem { id: string; knowerId: string; subject: string; content: string; certainty: string; }
export interface RelationshipGraph { nodes: Array<{ id: string; name: string; role: string }>; edges: Array<{ id: string; sourceId: string; targetId: string; type: string; attitudeSource: string | null; attitudeTarget: string | null; stage: string | null; sourceName: string; targetName: string }>; }
export function useResources(novelId?: string, ownerId?: string) {
  return useQuery({ queryKey: ["resources", novelId, ownerId], queryFn: async () => { const params: Record<string,string> = {}; if (ownerId) params.ownerId = ownerId; const { data } = await api.get(`/novels/${novelId}/resources`, { params }); return data.data as CharacterResourceItem[]; }, enabled: !!novelId });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: { novelId: string; ownerId: string; name: string; category: string; description?: string; acquiredIn?: number }) => { const { data } = await api.post(`/novels/${input.novelId}/resources`, input); return data.data; }, onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["resources", v.novelId] }); } });
}

export function useInfoProfiles(novelId?: string) {
  return useQuery({ queryKey: ["info-profiles", novelId], queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/info-profiles`); return data.data as InfoProfileItem[]; }, enabled: !!novelId });
}

export function useRelationshipGraph(novelId?: string) {
  return useQuery({ queryKey: ["rel-graph", novelId], queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/relations/graph`); return data.data as RelationshipGraph; }, enabled: !!novelId });
}

// Draft character relations (planning tab)
export function useDraftRelationshipGraph(novelId?: string) {
  return useQuery({
    queryKey: ["rel-graph", novelId],
    queryFn: async () => { const { data } = await api.get(`/novels/${novelId}/relations/graph`); return data.data as RelationshipGraph; },
    enabled: !!novelId,
  });
}

export function useUpsertDraftRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; sourceCharacterId: string; targetCharacterId: string; type: string }) => {
      const { data } = await api.post(`/novels/${input.novelId}/relations`, input);
      return data.data;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["rel-graph", v.novelId] }); },
  });
}

export function useUpsertRelation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: { novelId: string; sourceCharacterId: string; targetCharacterId: string; type: string; attitudeSource?: string; attitudeTarget?: string; stage?: string }) => { const { data } = await api.post(`/novels/${input.novelId}/relations`, input); return data.data; }, onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["rel-graph", v.novelId] }); } });
}

// Phase 0-1 architecture hooks → ./architecture.ts (re-exported at top)

export interface CharacterPresenceRecord {
  characterId: string;
  characterName: string;
  role: string;
  volumeOrder: number;
  presence: "active" | "inactive" | "returning" | "departing";
  trajectoryNote: string | null;
}

export interface VolumeCastRecommendation {
  volumeOrder: number;
  activeCharacters: Array<{ characterId: string; characterName: string; role: string; reason: string }>;
  returningCharacters: Array<{ characterId: string; characterName: string; role: string; returnReason: string }>;
  departingCharacters: Array<{ characterId: string; characterName: string; role: string; departReason: string }>;
  restingCharacters: Array<{ characterId: string; characterName: string; role: string }>;
}

export interface VolumeCompressionResult {
  volumeOrder: number;
  volumeTitle: string;
  summary: string;
  keyEvents: string[];
  characterChanges: string[];
  unresolvedPayoffs: string[];
  archiveDigest: string;
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

export function useVolumeCastRecommendation() {
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/character-schedule`);
      return data.data as VolumeCastRecommendation;
    },
  });
}

export function useCompressVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/compress`);
      return data.data as VolumeCompressionResult;
    },
    onSuccess: (_, { novelId }) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
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

// ─── Phase 3: Cool Points & Rhythm ────────────────────

export interface CoolPointStatus {
  volumeOrder: number;
  chaptersWritten: number;
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

export function useCoolPointStatus(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["coolpoint-status", novelId, volumeOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/coolpoint-status`);
      return data.data as CoolPointStatus;
    },
    enabled: !!novelId && volumeOrder !== undefined,
    staleTime: 30_000,
  });
}

export function useHookCheck(novelId?: string, chapterId?: string) {
  return useQuery({
    queryKey: ["hook-check", novelId, chapterId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/chapters/${chapterId}/hook-check`);
      return data.data as HookCheckResult;
    },
    enabled: !!novelId && !!chapterId,
    staleTime: 60_000,
  });
}

export function useHookDensity(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["hook-density", novelId, volumeOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/hook-density`);
      return data.data as HookDensityReport;
    },
    enabled: !!novelId && volumeOrder !== undefined,
    staleTime: 60_000,
  });
}

export function useVolumeRhythmReport(novelId?: string, volumeOrder?: number) {
  return useQuery({
    queryKey: ["rhythm-report", novelId, volumeOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/volumes/${volumeOrder}/rhythm-report`);
      return data.data as VolumeRhythmReport;
    },
    enabled: !!novelId && volumeOrder !== undefined,
  });
}

// ─── Phase 5: Cross-Volume Audit & Cost ───────────────

export interface AuditFinding {
  severity: "high" | "medium" | "low";
  category: string; location: string; description: string; suggestion: string;
}

export interface CrossVolumeAuditReport {
  novelId: string; auditedVolumeOrder: number;
  totalChaptersAudited: number; findings: AuditFinding[];
  summary: string; overallScore: number;
}

export interface CostSummaryData {
  novelId: string;
  totalInputTokens: number; totalOutputTokens: number;
  totalEstimatedCost: number; estimatedRemainingCost: number | null;
  averageCostPerChapter: number; chapterCount: number;
  budgetLimit: number | null; budgetPercent: number | null;
  warning: string | null;
}

export function useCrossVolumeAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/cross-audit`);
      return data.data as CrossVolumeAuditReport;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

export function useCostSummary(novelId?: string) {
  return useQuery({
    queryKey: ["cost-summary", novelId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/cost-summary`);
      return data.data as CostSummaryData;
    },
    enabled: !!novelId,
    staleTime: 30_000,
  });
}

export function useSetBudgetLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, limit }: { novelId: string; limit: number | null }) => {
      await api.put(`/novels/${novelId}/budget-limit`, { limit });
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["cost-summary", novelId] }); },
  });
}

// ─── Phase 2.5: Volume Rebalance ──────────────────────

export interface RebalanceResult {
  adjustedChapters: Array<{
    chapterOrder: number;
    changes: { conflictLevel?: number; shouldFeature?: string[]; payoffTouches?: string[] };
    reason: string;
  }>;
  summary: string;
}

export function useRebalanceVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, sortOrder }: { novelId: string; sortOrder: number }) => {
      const { data } = await api.post(`/novels/${novelId}/volumes/${sortOrder}/rebalance`);
      return data.data as RebalanceResult;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

// ─── Phase 2.8: Draft Optimize ─────────────────────────

export interface OptimizeResult {
  optimizedContent: string;
  changesSummary: string;
  preservedElements: string[];
}

export function useOptimizeChapter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ novelId, chapterId }: { novelId: string; chapterId: string }) => {
      const { data } = await api.post(`/novels/${novelId}/chapters/${chapterId}/optimize`);
      return data.data as OptimizeResult;
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

// ─── Phase 2.1: Character Dynamics ─────────────────────

export interface ChapterDynamics {
  dynamics: unknown;
  contextBlock: string;
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

// ─── Timeline ─────────────────────────────────────────

export interface ChapterReminder {
  title: string; category: string; sortOrder: number;
  status: string; isOverdue: boolean; isUpcoming: boolean;
}

export interface ChapterRemindersResult {
  reminders: ChapterReminder[]; summary: string;
}

export function useTimelineReminders(novelId?: string, chapterOrder?: number) {
  return useQuery({
    queryKey: ["timeline-reminders", novelId, chapterOrder],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/timeline/reminders/${chapterOrder}`);
      return data.data as ChapterRemindersResult;
    },
    enabled: !!novelId && chapterOrder !== undefined && chapterOrder > 0,
    staleTime: 30_000,
  });
}

// ─── Completion Readiness ───────────────────────────────

export interface CompletionReadiness {
  totalChapters: number;
  completedChapters: number;
  completionPercent: number;
  unrecycledPayoffs: number;
  characterArcsComplete: number;
  totalCharacterArcs: number;
  estimatedRemainingChapters: number | null;
  readinessVerdict: "ready" | "close" | "early";
}

export function useCompletionReadiness(novelId?: string) {
  return useQuery({
    queryKey: ["completion-readiness", novelId],
    queryFn: async () => {
      const { data } = await api.get(`/novels/${novelId}/completion-readiness`);
      return data.data as CompletionReadiness;
    },
    enabled: !!novelId,
    staleTime: 30_000,
  });
}

// ─── Reference Book: Writing Assets ────────────────────

export function useExtractWritingAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (novelId: string) => {
      const { data } = await api.post(`/novels/${novelId}/reference-book/extract-writing-assets`);
      return data.data;
    },
    onSuccess: (_data, novelId) => {
      qc.invalidateQueries({ queryKey: ["novel", novelId] });
    },
  });
}

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
