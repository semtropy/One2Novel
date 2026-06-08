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

// ─── 4.1: Undo snapshot helper ───────────────────────
function saveToHistory(currentContent: string, existingSceneCards: string | null): string {
  let cards: Record<string, unknown> = {};
  try { if (existingSceneCards) cards = JSON.parse(existingSceneCards); } catch {}
  const history: Array<{ ts: string; chars: number; content: string }> = (cards.editHistory as []) ?? [];
  history.push({ ts: new Date().toISOString(), chars: currentContent.length, content: currentContent });
  cards.editHistory = history.slice(-5); // keep last 5
  return JSON.stringify(cards);
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
  label: string;
  systemPrompt: string;
  strength: string;
}> = {
  polish: {
    label: "润色",
    strength: "conservative",
    systemPrompt: [
      "你是资深中文小说润色编辑。你的任务是优化表达，让文字更流畅、更有画面感。",
      "",
      "原则：",
      "1. 保留原文的所有核心信息、情节事实、人物状态。不做任何剧情修改。",
      "2. 优化句式节奏：打破连续同主语开头、打破单调的长短句模式。",
      "3. 增强画面感：用具体动作和感官细节替代抽象概括。",
      "4. 去除AI痕迹：删除「璀璨」「心潮澎湃」等套话、删除总结性语句。",
      "5. 保持原文的语气和叙事视角不变。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
  },
  expand: {
    label: "扩写",
    strength: "moderate",
    systemPrompt: [
      "你是资深中文小说编辑。你的任务是在不改变情节方向的前提下，为段落增加细节和层次。",
      "",
      "原则：",
      "1. 扩充感官描写：视觉（光/色/形）、听觉（声音/节奏）、触觉（温度/质感）、嗅觉、空间感。",
      "2. 增加动作层次：把单一动作拆成「准备→执行→后果→反应」的微节奏。",
      "3. 丰富内心活动：通过身体反应间接表现情感（手指发抖 > 他很紧张）。",
      "4. 不改变对话内容、不新增角色、不推进剧情时间线。",
      "5. 扩充后长度约为原文的1.5-2倍，但不得注水。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
  },
  compress: {
    label: "压缩",
    strength: "moderate",
    systemPrompt: [
      "你是资深中文小说编辑。你的任务是精简段落，保留核心信息，删除冗余。",
      "",
      "原则：",
      "1. 合并重复信息（同一件事说了两遍→保留最有画面感的版本）。",
      "2. 删除无效修饰：无信息量的形容词和副词。",
      "3. 压缩内心独白：保留最强的一个念头，删除反复琢磨的部分。",
      "4. 短句化：长句拆成2-3个短句，增强节奏感。",
      "5. 不删除情节推进、关键对话、伏笔线索。",
      "6. 压缩后长度约为原文的60-70%。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
  },
  rewrite_perspective: {
    label: "视角重写",
    strength: "moderate",
    systemPrompt: [
      "你是资深中文小说编辑。你的任务是用另一个角色的视角重写这段内容。",
      "",
      "原则：",
      "1. 切换到指定角色的感知范围：只写ta能看到、听到、推测到的事。",
      "2. 调整认知偏差：如果该角色不知道某个信息，就不得在叙述中透露。",
      "3. 保留原文的事件事实（发生了什么不变），但感知和解读可以不同。",
      "4. 保持该角色的语感和性格特征。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
  },
  adjust_tone: {
    label: "调整语气",
    strength: "conservative",
    systemPrompt: [
      "你是资深中文小说编辑。你的任务是调整段落的语气和情感基调。",
      "",
      "原则：",
      "1. 按用户指定的方向调整语气（更克制/更激烈/更温柔/更冷峻/更幽默）。",
      "2. 通过用词选择、句式长短、节奏快慢来实现语气变化，不要直接陈述情感。",
      "3. 保持原文的事件事实和角色行为不变。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
  },
  fix_ai_traces: {
    label: "去AI痕迹",
    strength: "moderate",
    systemPrompt: [
      "你是资深中文小说编辑，专精于去除AI生成文本的痕迹。",
      "",
      "识别并修复以下AI典型问题：",
      "1. 套话删除：「璀璨」「心潮澎湃」「油然而生」「不禁」「仿佛」「此情此景」→替换为具体描写。",
      "2. 成语堆砌：连续四字短语→至少一半展开为动作/场景细节。",
      "3. 连接词删除：「此外」「然而」「值得注意的是」→用动作切换代替逻辑连接。",
      "4. 总结句删除：段落结尾的「这一天的经历让ta...」「通过这次...」→删除，用剧情推进代替结论。",
      "5. 句式模板化：连续多句同主语→变换句式。",
      "",
      "只输出JSON，不要解释。",
    ].join("\n"),
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

  // Split chapter into paragraphs — replace closing+opening p tags with double newline
  const allParagraphs = chapter.content
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

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
    task: "repairer",
    systemPrompt: opConfig.systemPrompt,
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

  // 4.1: Save snapshot before modification
  const history = saveToHistory(chapter.content, chapter.sceneCards);
  await prisma.chapter.update({ where: { id: chapterId }, data: { sceneCards: history } });

  // Find the selected paragraphs in content — build a replacement range
  const paragraphs = chapter.content
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split(/\n{2,}/)
    .map(p => p.trim());

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
  const text = chapter.content.replace(/<[^>]*>/g, "");

  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 20);

  const systemPrompt = [
    "你是资深中文小说诊断编辑。扫描章节内容，找出需要修改的问题段落。",
    "",
    "检查维度：",
    "- AI痕迹：套话、成语堆砌、连接词滥用、总结句",
    "- 节奏问题：段落过长/过短、连续单调句式",
    "- 对话质量：无信息量寒暄、对话标签滥用",
    "- 情感表达：直接陈述情感（很愤怒→应改为握紧拳头）",
    "- 场景描写：缺乏感官细节、空间感模糊",
    "- 逻辑问题：角色行为不符性格、前后矛盾",
    "",
    "为每个问题输出诊断卡片(card)，包含：标题、问题摘要、为什么重要、推荐操作(polish|expand|compress|adjust_tone|fix_ai_traces)、问题段落索引(从1开始)、严重度(low|medium|high|critical)。",
    "如果有一个最值得优先修复的问题，输出recommendedTask。",
    "只输出JSON。",
  ].join("\n");

  const userPrompt = [
    ctx.characters ? `[角色约束]\n${ctx.characters.slice(0, 300)}` : "",
    ctx.outline ? `[本章义务]\n${ctx.outline}` : "",
    "",
    paragraphs.length > 0
      ? paragraphs.map((p, i) => `[段落${i + 1}]\n${p.slice(0, 500)}${p.length > 500 ? "..." : ""}`).join("\n\n")
      : text.slice(0, 6000),
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    task: "reviewer",
    systemPrompt,
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
