/**
 * Revision Service — paragraph-level AI revision with diff preview.
 * ADAPTED from OP NovelChapterEditorService.ts (258 lines) + chapterEditorShared.ts (388 lines).
 *
 * Operations: polish | expand | compress | rewrite_perspective | adjust_tone | fix_ai_traces
 */

import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";
import { assembleChapterContext } from "./contextAssembler";
import { computeDiff, diffSummary, type DiffChunk } from "./diffService";
import { splitParagraphs } from "./textUtils";

// ─── 4.1: Undo snapshot helper ───────────────────────
async function saveToHistory(prisma: ReturnType<typeof getPrisma>, chapterId: string, currentContent: string, scenePlan: string | null) {
  await prisma.chapterEditHistory.create({
    data: { chapterId, content: currentContent, sceneState: scenePlan },
  });
}

// ─── Types ─────────────────────────────────────────────

export type RevisionOperation =
  | "polish" | "expand" | "compress"
  | "rewrite_perspective" | "adjust_tone" | "fix_ai_traces";

export interface RewriteCandidate {
  label: string;
  content: string;
  summary: string;
  rationale: string;
  riskNotes: string[];
  diffChunks: DiffChunk[];
  diffStats: { added: number; removed: number };
}

export interface RevisionRequest {
  novelId: string;
  chapterId: string;
  operation: RevisionOperation;
  selectedParagraphs: string[];
  customInstruction?: string;
}

export interface WorkspaceDiagnosis {
  cards: Array<{
    title: string;
    problemSummary: string;
    whyItMatters: string;
    recommendedAction: RevisionOperation;
    paragraphIndex?: number;
    severity: "low" | "medium" | "high" | "critical";
  }>;
  recommendedTask?: {
    title: string;
    summary: string;
    action: RevisionOperation;
    paragraphIndex?: number;
  };
}

// ─── Operation configs ─────────────────────────────────

const OPERATION_CONFIG: Record<RevisionOperation, {
  assetId: string;
  label: string;
  strength: string;
}> = {
  polish: {
    assetId: "novel.chapter.rewrite.polish",
    label: "润色",
    strength: "conservative",
  },
  expand: {
    assetId: "novel.chapter.rewrite.expand",
    label: "扩写",
    strength: "moderate",
  },
  compress: {
    assetId: "novel.chapter.rewrite.compress",
    label: "压缩",
    strength: "moderate",
  },
  rewrite_perspective: {
    assetId: "novel.chapter.rewrite.perspective",
    label: "视角重写",
    strength: "moderate",
  },
  adjust_tone: {
    assetId: "novel.chapter.rewrite.tone",
    label: "调整语气",
    strength: "conservative",
  },
  fix_ai_traces: {
    assetId: "novel.chapter.rewrite.fix-ai",
    label: "去AI痕迹",
    strength: "moderate",
  },
};

// ─── Zod schema for LLM response ───────────────────────

const RewriteResponseSchema = z.object({
  candidates: z.array(z.object({
    label: z.string(),
    content: z.string(),
    summary: z.string(),
    rationale: z.string(),
    riskNotes: z.array(z.string()).optional().default([]),
  })).min(1).max(1),  // 1 candidate fits within token budget; multiple candidates exceed it
});

const DiagnosisSchema = z.object({
  cards: z.array(z.object({
    title: z.string(),
    problemSummary: z.string(),
    whyItMatters: z.string(),
    recommendedAction: z.string(),
    paragraphIndex: z.number().optional(),
    severity: z.string(),
  })),
  recommendedTask: z.object({
    title: z.string(),
    summary: z.string(),
    action: z.string(),
    paragraphIndex: z.number().optional(),
  }).optional(),
});

// ─── Core functions ────────────────────────────────────

/** Build a paragraph window for context (N paragraphs before + after) */
function buildParagraphWindow(
  allParagraphs: string[],
  selectedIndices: number[],
  windowSize = 3,
): { before: string[]; selected: string[]; after: string[] } {
  const minIdx = Math.min(...selectedIndices);
  const maxIdx = Math.max(...selectedIndices);
  const before = allParagraphs.slice(Math.max(0, minIdx - windowSize), minIdx);
  const selected = allParagraphs.slice(minIdx, maxIdx + 1);
  const after = allParagraphs.slice(maxIdx + 1, maxIdx + 1 + windowSize);
  return { before, selected, after };
}

/** Build macro context summary for the revision prompt */
function buildRevisionContext(chapterContext: Awaited<ReturnType<typeof assembleChapterContext>>): string {
  const parts: string[] = [];
  if (chapterContext.characters) parts.push(`[角色约束]\n${chapterContext.characters.slice(0, 500)}`);
  if (chapterContext.outline) parts.push(`[本章义务]\n${chapterContext.outline}`);
  if (chapterContext.payoffContext) parts.push(`[伏笔指令]\n${chapterContext.payoffContext}`);
  return parts.join("\n\n");
}

export async function generateRewriteCandidates(
  input: RevisionRequest,
): Promise<RewriteCandidate[]> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: input.chapterId } });
  if (!chapter?.content) throw new Error("Chapter has no content");

  const ctx = await assembleChapterContext(input.novelId, input.chapterId);
  const opConfig = OPERATION_CONFIG[input.operation];

  const allParagraphs = splitParagraphs(chapter.content);

  // Find selected paragraphs in content — frontend now sends full paragraphs,
  // so exact match should work; fuzzy match for edge cases (whitespace diffs)
  const selectedIndices: number[] = [];
  for (const selPara of input.selectedParagraphs) {
    const normalized = selPara.trim().replace(/\s+/g, " ");
    // Try: exact → normalize whitespace → includes match
    let idx = allParagraphs.findIndex(p => p.trim() === selPara.trim());
    if (idx < 0) idx = allParagraphs.findIndex(p => p.trim().replace(/\s+/g, " ") === normalized);
    if (idx < 0) idx = allParagraphs.findIndex(p => p.replace(/\s+/g, " ").includes(normalized.slice(0, 50)));
    if (idx >= 0 && !selectedIndices.includes(idx)) selectedIndices.push(idx);
  }

  if (selectedIndices.length === 0) {
    throw new Error("无法在原文中定位选中段落，请重新选择");
  }
  const window = buildParagraphWindow(allParagraphs, selectedIndices);

  const revisionContext = buildRevisionContext(ctx);

  const userPrompt = [
    input.customInstruction
      ? `【用户指令】${input.customInstruction}`
      : "",
    revisionContext ? `\n【章节背景】\n${revisionContext}` : "",
    window.before.length > 0 ? `\n【前文】\n${window.before.join("\n")}` : "",
    `\n【待${opConfig.label}段落】\n${window.selected.join("\n")}`,
    window.after.length > 0 ? `\n【后文】\n${window.after.join("\n")}` : "",
    `输出待${opConfig.label}段落改写之后的内容。content字段中只能包含待编辑段落改写后的文字，不得包含未选中的段落内容。summary、rationale、riskNotes 等其他字段按 Schema 要求填写。只输出JSON。`,
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    assetId: opConfig.assetId,
    userPrompt,
    schema: RewriteResponseSchema,
    temperature: input.operation === "polish" || input.operation === "fix_ai_traces" ? 0.3 : 0.5,
    maxTokens: 4096,   // structured output with 2-3 candidates needs headroom
  });

  return raw.candidates.map(c => {
    const normalizedContent = c.content.replace(/\n{3,}/g, "\n\n").trim();
    const selectedText = window.selected.join("\n");
    const diffChunks = computeDiff(selectedText, normalizedContent);
    const diffStats = diffSummary(selectedText, normalizedContent);
    return {
      label: c.label,
      content: normalizedContent,
      summary: c.summary,
      rationale: c.rationale,
      riskNotes: c.riskNotes ?? [],
      diffChunks,
      diffStats,
    };
  });
}

/** Apply a revision by replacing selected paragraphs in chapter content */
export async function applyRevision(
  chapterId: string,
  selectedParagraphs: string[],
  replacementText: string,
): Promise<{ success: boolean; wordCount: number }> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) throw new Error("Chapter not found");

  // 4.1: Save snapshot before modification to edit history
  await saveToHistory(prisma, chapterId, chapter.content, chapter.scenePlan);

  // Find the selected paragraphs in content — build a replacement range
  const paragraphs = splitParagraphs(chapter.content);

  const indices: number[] = [];
  for (const selPara of selectedParagraphs) {
    const normalized = selPara.trim();
    let idx = paragraphs.findIndex(p => p === normalized);
    if (idx < 0) idx = paragraphs.findIndex(p => p.includes(normalized.slice(0, 50)));
    if (idx < 0) idx = paragraphs.findIndex(p => p.includes(normalized.slice(0, 30)));
    if (idx >= 0 && !indices.includes(idx)) indices.push(idx);
  }

  if (indices.length === 0) throw new Error("Selected text not found in chapter content");
  indices.sort((a, b) => a - b);

  // Find the character range in the full content
  // We join paragraphs back with \n\n to match the original splitting pattern
  const minIdx = indices[0];
  const maxIdx = indices[indices.length - 1];
  const beforeParas = paragraphs.slice(0, minIdx);
  const afterParas = paragraphs.slice(maxIdx + 1);

  const before = (beforeParas.length > 0 ? beforeParas.join("\n\n") + "\n\n" : "");
  const after = (afterParas.length > 0 ? "\n\n" + afterParas.join("\n\n") : "");
  const newContent = before + replacementText + after;

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { content: newContent },
  });

  return {
    success: true,
    wordCount: newContent.replace(/<[^>]*>/g, "").length,
  };
}

/** Diagnose a chapter for writing issues */
export async function diagnoseWorkspace(
  novelId: string,
  chapterId: string,
): Promise<WorkspaceDiagnosis> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) throw new Error("Chapter has no content");

  const ctx = await assembleChapterContext(novelId, chapterId);
  const paragraphs = splitParagraphs(chapter.content).filter(p => p.length > 20);

  
  const userPrompt = [
    ctx.characters ? `[角色约束]\n${ctx.characters.slice(0, 300)}` : "",
    ctx.outline ? `[本章义务]\n${ctx.outline}` : "",
    "",
    paragraphs.length > 0
      ? paragraphs.map((p, i) => `[段落${i + 1}]\n${p.slice(0, 500)}${p.length > 500 ? "..." : ""}`).join("\n\n")
      : chapter.content.replace(/<[^>]*>/g, "").slice(0, 6000),
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    assetId: "novel.chapter.diagnose",
    userPrompt,
    schema: DiagnosisSchema,
    temperature: 0.3,
  });

  const validActions = new Set(["polish", "expand", "compress", "rewrite_perspective", "adjust_tone", "fix_ai_traces"]);
  return {
    cards: raw.cards.map(c => ({
      ...c,
      recommendedAction: validActions.has(c.recommendedAction)
        ? (c.recommendedAction as RevisionOperation)
        : "polish",
      severity: (["low", "medium", "high", "critical"].includes(c.severity)
        ? c.severity : "medium") as WorkspaceDiagnosis["cards"][number]["severity"],
    })),
    recommendedTask: raw.recommendedTask ? {
      ...raw.recommendedTask,
      action: validActions.has(raw.recommendedTask.action)
        ? (raw.recommendedTask.action as RevisionOperation)
        : "polish",
    } : undefined,
  };
}
