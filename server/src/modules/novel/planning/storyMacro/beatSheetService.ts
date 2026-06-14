import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";

const BeatSheetOutput = z.object({
  beats: z.array(z.object({
    chapterOrder: z.number(),
    beatType: z.string(),
    goal: z.string(),
    conflict: z.string(),
    reveal: z.string(),
    emotionBeat: z.string(),
  })),
  structureDiagnosis: z.string(),
});

export interface BeatSheet {
  beats: Array<{ chapterOrder: number; beatType: string; goal: string; conflict: string; reveal: string; emotionBeat: string }>;
  structureDiagnosis: string;
}

export interface BeatSheetOptions {
  /** Chapters from structuredOutline for preview mode (before DB has volumes). */
  outlineChapters?: Array<{ order: number; title: string; summary: string }>;
}

/**
 * Generate a beat sheet for a volume.
 *
 * Accepted call patterns:
 *   generateBeatSheet(novelId, volumeId)           — volumeId as string (from volumeChapter.routes.ts)
 *   generateBeatSheet(novelId, volumeSortOrder)    — sortOrder as number, with optional outlineChapters
 *   generateBeatSheet(novelId, volumeSortOrder, options)
 *
 * Automatically detects: if first param is a cuid-style string → direct volumeId lookup;
 * if a number → sortOrder lookup with optional structuredOutline fallback.
 */
export async function generateBeatSheet(
  novelId: string,
  volumeIdOrSortOrder: string | number,
  options?: BeatSheetOptions,
): Promise<BeatSheet> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { title: true, genre: true, structuredOutline: true },
  });

  let volTitle: string;
  let volSummary: string;
  let chapters: string;
  let chapterPlans: Array<{ id: string; chapterOrder: number }>;

  if (typeof volumeIdOrSortOrder === "string") {
    // Direct volumeId lookup
    const volume = await prisma.volume.findUnique({
      where: { id: volumeIdOrSortOrder },
      include: { draftPlans: { orderBy: { chapterOrder: "asc" } } },
    });
    if (!volume) throw new Error("Volume not found");

    volTitle = volume.title;
    volSummary = volume.summary ?? "";
    chapters = volume.draftPlans.map(p =>
      `第${p.chapterOrder}章《${p.title}》：${p.summary ?? ""}`).join("\n");
    chapterPlans = await prisma.volumeChapterPlan.findMany({
      where: { volumeId: volume.id },
      orderBy: { chapterOrder: "asc" },
      select: { id: true, chapterOrder: true },
    });
  } else {
    // SortOrder lookup
    const volumeSortOrder = volumeIdOrSortOrder;
    const volumes = await prisma.volume.findMany({
      where: { novelId, sortOrder: volumeSortOrder },
      include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } },
    });

    if (volumes.length > 0) {
      // DB records exist (after applyOutline)
      const vol = volumes[0];
      volTitle = vol.title;
      volSummary = vol.summary ?? "";
      chapters = vol.chapterPlans.map(p =>
        `第${p.chapterOrder}章 ${p.title ?? ""}: ${p.summary ?? ""}`).join("\n");
      chapterPlans = vol.chapterPlans.map(p => ({ id: p.id, chapterOrder: p.chapterOrder }));
    } else if (options?.outlineChapters && options.outlineChapters.length > 0) {
      // Fallback: use chapters from structuredOutline (preview mode, before apply)
      const outline = JSON.parse(novel?.structuredOutline ?? "{}");
      const vol = (outline.volumes as Array<{ sortOrder: number; title: string; summary: string }> | undefined)
        ?.find(v => v.sortOrder === volumeSortOrder);
      volTitle = vol?.title ?? `第${volumeSortOrder}卷`;
      volSummary = vol?.summary ?? "";
      chapters = options.outlineChapters.map(c =>
        `第${c.order}章 ${c.title}: ${c.summary}`).join("\n");
      chapterPlans = []; // No DB records to update
    } else {
      throw new Error("Volume not found");
    }
  }

  const result = await aiInvoke({
    assetId: "novel.volume.beat-sheet",
    userPrompt: `书名：《${novel?.title ?? ""}》\n题材：${novel?.genre ?? ""}\n卷：${volTitle}\n概要：${volSummary}\n\n章节：\n${chapters}`,
    schema: BeatSheetOutput,
    temperature: 0.5,
  });

  // Persist to DB only if chapterPlans exist
  for (const beat of result.beats) {
    const plan = chapterPlans.find(p => p.chapterOrder === beat.chapterOrder);
    if (plan) {
      await prisma.volumeChapterPlan.update({
        where: { id: plan.id },
        data: {
          purpose: beat.goal,
          conflictLevel: beat.beatType === "pressure" || beat.beatType === "turn" ? 8
            : beat.beatType === "cooldown" ? 3 : 5,
          revealLevel: beat.beatType === "turn" || beat.beatType === "payoff" ? 8
            : beat.beatType === "setup" ? 3 : 5,
          taskSheet: JSON.stringify({
            conflict: beat.conflict,
            reveal: beat.reveal,
            emotionBeat: beat.emotionBeat,
          }),
        },
      });
    }
  }
  return result;
}
