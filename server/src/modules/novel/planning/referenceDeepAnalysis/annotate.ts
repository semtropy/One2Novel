import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import type { ParsedChapter, ChapterAnnotation } from "./index";
import { REF_ANALYSIS_MAX_CHARS } from "../../../../platform/config/constants";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

const BASE_BATCH_SIZE = 15;
const CONCURRENCY = 5; // Number of parallel batch groups

const BatchAnnotationSchema = z.object({
  chapters: z.array(z.object({
    chapterIndex: z.number(),
    chapterType: z.enum(["advance", "transition", "cooldown", "climax"]),
    coolPointLevel: z.enum(["high", "medium", "low"]),
    hookType: z.enum(["suspense", "reversal", "preview", "emotional"]),
    contentBeat: z.string(),
    secondaryBeat: z.string().optional(),
    conflictIntensity: z.number().int().min(1).max(10),
    openingType: z.enum(["action", "dialogue", "environment", "internal", "exposition"]),
    summary: z.string(),
  })),
});

async function annotateBatch(
  chapters: ParsedChapter[], text: string, batchIndex: number, totalBatches: number, batchSize: number,
): Promise<ChapterAnnotation[]> {
  const startIdx = batchIndex * batchSize;
  const batchChapters = chapters.slice(startIdx, startIdx + batchSize);
  if (batchChapters.length === 0) return [];

  const excerpts = batchChapters.map(ch => {
    const content = text.slice(ch.startChar, ch.endChar).trim();
    return `=== 第${ch.index}章 ${ch.title} ===\n${content}`;
  }).join("\n\n");

  const userPrompt = [
    `批注 ${batchChapters.length} 章（批次 ${batchIndex + 1}/${totalBatches}）`,
    `章节目录：${batchChapters.map(c => `第${c.index}章 ${c.title}`).join("、")}`,
    "", excerpts,
  ].join("\n");

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await aiInvoke({ assetId: "novel.chapter.annotate", userPrompt, schema: BatchAnnotationSchema, temperature: 0.3 });
      const results: ChapterAnnotation[] = raw.chapters.filter(a => a.chapterIndex > 0) as any;
      // Enrich with exemplar text snippets
      for (const a of results) {
        const ch = chapters.find(c => c.index === a.chapterIndex);
        if (ch) {
          a.exemplarOpening = text.slice(ch.startChar, ch.startChar + 300).trim().replace(/\n/g, " ");
          a.exemplarEnding = text.slice(Math.max(ch.startChar, ch.endChar - 300), ch.endChar).trim().replace(/\n/g, " ");
        }
      }
      return results;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 3) { const delay = Math.pow(2, attempt) * 1000; console.warn(`[Batch] ${batchIndex + 1} attempt ${attempt} failed, retrying in ${delay}ms`); await new Promise(r => setTimeout(r, delay)); }
    }
  }
  throw lastError || new Error(`Batch ${batchIndex + 1} failed`);
}

export async function batchAnnotateChapters(
  chapters: ParsedChapter[], text: string, profileId: string,
  onProgress?: (batch: number, total: number) => Promise<void>,
): Promise<ChapterAnnotation[]> {
  const avgChapterSize = chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length;
  const batchSize = Math.max(5, Math.min(BASE_BATCH_SIZE, Math.floor(REF_ANALYSIS_MAX_CHARS / avgChapterSize)));
  const totalBatches = Math.ceil(chapters.length / batchSize);

  const prisma = getPrisma();
  const existing = await prisma.referenceProfile.findUnique({ where: { id: profileId }, select: { chapterAnnotations: true } });
  let results: ChapterAnnotation[] = [];
  let doneIndices = new Set<number>();
  if (existing?.chapterAnnotations) {
    try { const saved = JSON.parse(existing.chapterAnnotations) as ChapterAnnotation[]; results = saved; doneIndices = new Set(saved.map(a => a.chapterIndex)); console.log(`[Batch] Resuming: ${results.length} already annotated`); } catch (e) { console.error(`[Batch] Resume parse failed: ${e instanceof Error ? e.message : e}`); }
  }

  // Build pending batch indices (skip already-completed batches)
  const pendingBatches: number[] = [];
  for (let i = 0; i < totalBatches; i++) {
    const startIdx = i * batchSize;
    if (!chapters.slice(startIdx, startIdx + batchSize).every(c => doneIndices.has(c.index))) {
      pendingBatches.push(i);
    }
  }

  // Process in concurrent groups of CONCURRENCY
  let completedCount = results.length;
  for (let g = 0; g < pendingBatches.length; g += CONCURRENCY) {
    const group = pendingBatches.slice(g, g + CONCURRENCY);
    const groupResults = await Promise.all(
      group.map(i => annotateBatch(chapters, text, i, totalBatches, batchSize).catch(e => {
        console.warn(`[Batch] ${i + 1}/${totalBatches} failed: ${e instanceof Error ? e.message : e}`);
        return [] as ChapterAnnotation[];
      }))
    );

    // Merge results and persist after each group
    for (const batch of groupResults) {
      for (const a of batch) {
        const idx = results.findIndex(r => r.chapterIndex === a.chapterIndex);
        if (idx >= 0) results[idx] = a; else results.push(a);
      }
      completedCount = results.length;
    }
    await prisma.referenceProfile.update({
      where: { id: profileId },
      data: { chapterAnnotations: JSON.stringify(results.sort((a, b) => a.chapterIndex - b.chapterIndex)) },
    }).catch(e => logEventError("annotate.persist", { profileId }, e)); // intentional: fire-and-forget, failure tolerated

    const lastInGroup = group[group.length - 1] + 1;
    console.log(`[Batch] ~${lastInGroup}/${totalBatches}: ${completedCount} total annotated (${Math.round(completedCount / chapters.length * 100)}%)`);
    if (onProgress) await onProgress(lastInGroup, totalBatches);
  }
  return results.sort((a, b) => a.chapterIndex - b.chapterIndex);
}
