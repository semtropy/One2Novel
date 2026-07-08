/**
 * Volume Incremental Compressor — 当前卷增量压缩
 *
 * 核心问题：tieredCompressionService 只跨卷压缩，不跨章压缩。
 * 一个 50 章的卷，写到第 40 章时，第 1-20 章的内容完全没有压缩摘要。
 *
 * 解决方案：每 10 章触发一次 LLM 结构化摘要（非机械截断），
 * 保留关键事件、角色状态变化、世界观揭示。
 */
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────

export interface IncrementalSummary {
  chapterRange: [number, number];
  summary: string;              // ~1000 chars — 本段章节的核心事件
  keyEvents: string[];          // 3-5 个关键事件
  characterChanges: string[];   // 角色状态变化
  worldReveals: string[];       // 新揭示的世界观/规则
  unresolvedPayoffs: string[];  // 未闭合的伏笔
}

// ─── LLM Schema ─────────────────────────────────────────

const IncrementalSummarySchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()).min(1).max(5),
  characterChanges: z.array(z.string()).default([]),
  worldReveals: z.array(z.string()).default([]),
  unresolvedPayoffs: z.array(z.string()).default([]),
});

// ─── Public API ──────────────────────────────────────────

/**
 * 增量压缩：对指定范围的章节生成结构化摘要。
 * 每 10 章触发一次。
 */
export async function compressIncremental(
  novelId: string,
  startChapter: number,
  endChapter: number,
): Promise<IncrementalSummary> {
  const prisma = getPrisma();

  // 获取范围内的章节摘要
  const chapters = await prisma.chapter.findMany({
    where: {
      novelId,
      order: { gte: startChapter, lte: endChapter },
      chapterStatus: "completed",
    },
    select: {
      order: true,
      title: true,
      content: true,
      chapterSummary: { select: { summary: true } },
      expectation: true,
    },
    orderBy: { order: "asc" },
  });

  if (chapters.length === 0) {
    return {
      chapterRange: [startChapter, endChapter],
      summary: "",
      keyEvents: [],
      characterChanges: [],
      worldReveals: [],
      unresolvedPayoffs: [],
    };
  }

  // 构建压缩输入
  const chapterTexts = chapters.map(ch => {
    const summary = ch.chapterSummary?.summary
      ?? ch.content?.slice(0, 500)
      ?? ch.expectation
      ?? "";
    return `第${ch.order}章《${ch.title}》：${summary}`;
  }).join("\n");

  // 调用 LLM 生成结构化摘要
  const raw = await aiInvoke({
    assetId: "novel.volume.compress",
    novelId,
    userPrompt: [
      `请为以下章节范围生成增量压缩摘要：`,
      `范围：第${startChapter}章 - 第${endChapter}章`,
      `章节内容：\n${chapterTexts.slice(0, 12000)}`,
      `要求：提取关键事件、角色变化、世界观揭示、未闭合伏笔。`,
    ].filter(Boolean).join("\n"),
    schema: IncrementalSummarySchema,
    temperature: 0.4,
  });

  // 存储到 DB
  await prisma.incrementalSummary.create({
    data: {
      novelId,
      startChapter,
      endChapter,
      summary: raw.summary,
      keyEvents: JSON.stringify(raw.keyEvents),
      characterChanges: JSON.stringify(raw.characterChanges),
      worldReveals: JSON.stringify(raw.worldReveals),
      unresolvedPayoffs: JSON.stringify(raw.unresolvedPayoffs),
    },
  });

  return {
    chapterRange: [startChapter, endChapter],
    summary: raw.summary,
    keyEvents: raw.keyEvents,
    characterChanges: raw.characterChanges,
    worldReveals: raw.worldReveals,
    unresolvedPayoffs: raw.unresolvedPayoffs,
  };
}

/**
 * 构建当前卷增量上下文。
 * 合并所有之前的增量摘要，生成写作上下文块。
 */
export async function buildCurrentVolumeContext(
  novelId: string,
  currentChapterOrder: number,
): Promise<string> {
  const prisma = getPrisma();

  const summaries = await prisma.incrementalSummary.findMany({
    where: {
      novelId,
      endChapter: { lt: currentChapterOrder },
    },
    orderBy: { startChapter: "desc" },
    take: 10, // 最近的 10 个增量摘要（覆盖前 100 章）
  });

  if (summaries.length === 0) return "";

  const lines = ["【当前卷增量摘要 — 本章所在卷的前面章节的 LLM 结构化摘要。】"];

  for (const s of summaries) {
    const keyEvents = JSON.parse(s.keyEvents ?? "[]") as string[];
    const charChanges = JSON.parse(s.characterChanges ?? "[]") as string[];
    const worldReveals = JSON.parse(s.worldReveals ?? "[]") as string[];

    lines.push(`\n== 第${s.startChapter}-${s.endChapter}章 ==`);
    lines.push(`概要：${s.summary.slice(0, 500)}`);

    if (keyEvents.length > 0) {
      lines.push(`关键事件：${keyEvents.slice(0, 3).join("；")}`);
    }
    if (charChanges.length > 0) {
      lines.push(`角色变化：${charChanges.slice(0, 3).join("；")}`);
    }
    if (worldReveals.length > 0) {
      lines.push(`世界观揭示：${worldReveals.slice(0, 2).join("；")}`);
    }
  }

  return lines.join("\n");
}

/**
 * 触发增量压缩的调度器。
 * 每写 10 章自动调用一次。
 */
export async function maybeCompressIncremental(
  novelId: string,
  chapterOrder: number,
): Promise<void> {
  // 每 10 章触发一次
  if (chapterOrder % 10 !== 0) return;

  const startChapter = chapterOrder - 9;
  if (startChapter < 1) return;

  try {
    await compressIncremental(novelId, startChapter, chapterOrder);
  } catch (e) {
    console.error(`[VolumeCompressor] Failed to compress chapters ${startChapter}-${chapterOrder}:`, e);
  }
}
