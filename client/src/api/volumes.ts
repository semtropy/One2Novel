/**
 * Volume API hooks — rebalance, cross-volume audit, compress.
 * Split from api/novel.ts
 */
import { createMutationHook } from "./factory";

export interface VolumeCompressionResult {
  volumeOrder: number; volumeTitle: string; summary: string;
  keyEvents: string[]; characterChanges: string[];
  unresolvedPayoffs: string[]; archiveDigest: string;
}

export interface AuditFinding {
  severity: "high" | "medium" | "low";
  category: string; location: string; description: string; suggestion: string;
}

export interface CrossVolumeAuditReport {
  novelId: string; auditedVolumeOrder: number;
  totalChaptersAudited: number; findings: AuditFinding[];
  summary: string; overallScore: number;
}

export interface RebalanceResult {
  adjustedChapters: Array<{
    chapterOrder: number;
    changes: { conflictLevel?: number; shouldFeature?: string[]; payoffTouches?: string[] };
    reason: string;
  }>;
  summary: string; appliedCount: number;
}

type NovelVolumeInput = { novelId: string; sortOrder: number };

export const useRebalanceVolume = createMutationHook<NovelVolumeInput, RebalanceResult>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/volumes/${input.sortOrder}/rebalance`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useCrossVolumeAudit = createMutationHook<NovelVolumeInput, CrossVolumeAuditReport>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/volumes/${input.sortOrder}/cross-audit`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});

export const useCompressVolume = createMutationHook<NovelVolumeInput, VolumeCompressionResult>({
  method: "post",
  url: (input) => `/novels/${input.novelId}/volumes/${input.sortOrder}/compress`,
  body: () => undefined,
  invalidateKeys: (input) => [["novel", input.novelId]],
});
