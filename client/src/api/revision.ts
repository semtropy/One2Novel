import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../app/api";

// ─── Types ─────────────────────────────────────────────

export type RevisionOperation = "polish" | "expand" | "compress" | "rewrite_perspective" | "adjust_tone" | "fix_ai_traces";

export interface DiffChunk { type: "equal" | "insert" | "delete"; text: string; }

export interface RewriteCandidate {
  label: string; content: string; summary: string; rationale: string;
  riskNotes: string[]; diffChunks: DiffChunk[];
  diffStats: { added: number; removed: number };
}

export interface DiagnosisCard {
  title: string; problemSummary: string; whyItMatters: string;
  recommendedAction: RevisionOperation; paragraphStart?: number; paragraphEnd?: number;
  severity: "low" | "medium" | "high" | "critical";
}

export interface WorkspaceDiagnosis {
  cards: DiagnosisCard[];
  recommendedTask?: { title: string; summary: string; action: RevisionOperation; paragraphStart?: number; paragraphEnd?: number };
}

// ─── Operation display ─────────────────────────────────

export const OPERATION_LABELS: Record<RevisionOperation, { label: string; emoji: string; desc: string }> = {
  polish: { label: "润色", emoji: "✨", desc: "优化表达，更流畅更有画面感" },
  expand: { label: "扩写", emoji: "➕", desc: "增加感官细节和动作层次" },
  compress: { label: "压缩", emoji: "➖", desc: "精简冗余，保留核心信息" },
  rewrite_perspective: { label: "视角重写", emoji: "👁", desc: "换角色视角重写段落" },
  adjust_tone: { label: "调整语气", emoji: "🎭", desc: "调整语气和情感基调" },
  fix_ai_traces: { label: "去AI痕迹", emoji: "🤖", desc: "删除套话、成语堆砌、总结句" },
};

// ─── Hooks ─────────────────────────────────────────────

export function useRevisionCandidates() {
  return useMutation({
    mutationFn: async (input: {
      novelId: string; chapterId: string; operation: RevisionOperation;
      selectedParagraphs: string[]; customInstruction?: string;
    }) => {
      const { data } = await api.post(
        `/novels/${input.novelId}/chapters/${input.chapterId}/revision/candidates`,
        { operation: input.operation, selectedParagraphs: input.selectedParagraphs, customInstruction: input.customInstruction },
      );
      return data.data as RewriteCandidate[];
    },
  });
}

export function useApplyRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { novelId: string; chapterId: string; selectedText: string; replacementText: string }) => {
      const { data } = await api.post(
        `/novels/${input.novelId}/chapters/${input.chapterId}/revision/apply`,
        { selectedText: input.selectedText, replacementText: input.replacementText },
      );
      return data.data as { success: boolean; wordCount: number };
    },
    onSuccess: (_, { novelId }) => { qc.invalidateQueries({ queryKey: ["novel", novelId] }); },
  });
}

export function useWorkspaceDiagnosis() {
  return useMutation({
    mutationFn: async (input: { novelId: string; chapterId: string }) => {
      const { data } = await api.post(
        `/novels/${input.novelId}/chapters/${input.chapterId}/diagnose`,
      );
      return data.data as WorkspaceDiagnosis;
    },
  });
}
