import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";
import { generateBeatSheet } from "./storyMacro/beatSheetService";
import { getStoryCore, generateStoryCore } from "./storyCoreService";
import { validateAndSummarize, type ValidationReport } from "./storyMacro/constraintEngine";

const DEFAULT_CONFLICT_LEVEL = 5;
const DEFAULT_REVEAL_LEVEL = 5;

// Note: chapter/volume indices + chapters array are optional with server-side defaults
const LLMChapterSchema = z.object({
  chapter: z.number().int().optional(), title: z.string(), coreEvent: z.string(), hook: z.string(),
  summary: z.string(), characters: z.array(z.string()).optional(),
});
const LLMVolumeSchema = z.object({
  volume: z.number().int().optional(), title: z.string(), theme: z.string().optional(),
  chapters: z.array(LLMChapterSchema).default([]),
});
const BlueprintSchema = z.object({
  volumes: z.array(LLMVolumeSchema),
});

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

/**
 * Generate blueprint (volume→chapter structure) for long-form novels.
 *
 * @returns The blueprint result plus structural validation.
 */
export async function generateBlueprint(
  novelId: string,
  preferredVolumes?: number,
): Promise<{ result: BlueprintResult; validation: ValidationReport; needsRegeneration?: boolean }> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Volume/chapter count defaults for the flat blueprint approach
  // (loop-based generation uses loopSkeleton, not these preferences)

  // Read story core directly from Novel columns (no more DraftStorySeed)
  let storyCore = await getStoryCore(novelId);
  if (!storyCore) {
    const core = await generateStoryCore(novelId);
    storyCore = { storySummary: core.storySummary, centralQuestion: core.centralQuestion, endingDirection: core.endingDirection };
  }

  const characters = await prisma.novelCharacter.findMany({ where: { novelId }, select: { name: true, role: true, identityLabel: true } });
  const charContext = characters.length > 0
    ? `\n已有角色：${characters.map(c => `${c.name}（${c.role}${c.identityLabel ? `·${c.identityLabel}` : ""}）`).join("、")}`
    : "";

  const context = [
    `书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null,
    novel.description ? `概述：${novel.description.slice(0, 8000)}` : null,
    "",
    "【已确定的故事核心 — 以此为硬约束生成卷章结构】",
    `故事简介：${storyCore.storySummary}`,
    storyCore.centralQuestion ? `核心悬念：${storyCore.centralQuestion}` : null,
    storyCore.endingDirection ? `结局方向：${storyCore.endingDirection}` : null,
    charContext,
  ].filter(Boolean).join("\n");

  const targetChapters = novel.estimatedChapterCount || 333; // LONG_FORM_DEFAULT_CHAPTERS
  const volCount = preferredVolumes && preferredVolumes >= 2 && preferredVolumes <= 8
    ? preferredVolumes
    : Math.max(2, Math.min(8, Math.round(targetChapters / 8)));
  const chPerVol = Math.max(4, Math.min(12, Math.round(targetChapters / volCount)));

  // Feed reference book analysis as supplementary context
  const refBook = await prisma.referenceBook.findUnique({ where: { novelId } });
  let refContext = "";
  if (refBook?.annotations) {
    try {
      const annotations = JSON.parse(refBook.annotations);
      if (annotations.highCoolChapters?.length > 0) {
        refContext = `\n【参考书节奏数据】爽点高峰分布在：${annotations.highCoolChapters.slice(0, 5).join("、")}章附近。可作为章节节奏参考。`;
      }
    } catch { /* ignore */ }
  }

  const raw = await aiInvoke({
    assetId: "novel.blueprint.generate",
    templateVars: { volCount: String(volCount), chPerVol: String(chPerVol), targetChapters: String(targetChapters) },
    userPrompt: `为以下小说生成章节蓝图：\n\n${context}${refContext}`,
    schema: BlueprintSchema,
    temperature: 0.8,
    novelId,
  });

  const result: BlueprintResult = {
    volumes: raw.volumes.map((vol, vi) => ({
      sortOrder: vol.volume ?? vi + 1, title: vol.title, summary: vol.theme ?? "",
      chapters: vol.chapters.map((ch, ci) => ({
        order: ch.chapter ?? ci + 1, title: ch.title, summary: ch.summary ?? ch.coreEvent ?? "",
        coreEvent: ch.coreEvent ?? "", hook: ch.hook ?? "", characters: ch.characters ?? [],
        conflictLevel: DEFAULT_CONFLICT_LEVEL, revealLevel: DEFAULT_REVEAL_LEVEL,
      })),
    })),
  };

  // Structural validation
  const { report: validation, needsRegeneration } = validateAndSummarize({
    storySummary: storyCore.storySummary,
    centralQuestion: storyCore.centralQuestion,
    endingDirection: storyCore.endingDirection,
    volumes: result.volumes,
  });

  if (needsRegeneration) {
    console.warn(`[Blueprint] Structure has multiple high-severity violations for novel ${novelId}. Consider re-generating.`);
  }

  // Update estimated chapter count and persist blueprint to structuredOutline
  await prisma.novel.update({
    where: { id: novelId },
    data: {
      structuredOutline: JSON.stringify(result),
      estimatedChapterCount: result.volumes.reduce((s, v) => s + v.chapters.length, 0),
    },
  });

  return { result, validation, needsRegeneration: needsRegeneration || undefined };
}

/**
 * Apply blueprint to writing tables: clear old chapters/volumes and recreate from structuredOutline.
 * Generates beat sheets for each volume after recreation.
 */
export async function applyBlueprint(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel?.structuredOutline) throw new Error("No blueprint to apply");

  const blueprint: BlueprintResult = JSON.parse(novel.structuredOutline);

  await prisma.$transaction(async (tx) => {
    await tx.volumeChapterPlan.deleteMany({ where: { volume: { novelId } } });
    await tx.volume.deleteMany({ where: { novelId } });
    await tx.chapter.deleteMany({ where: { novelId } });

    let globalOrder = 0;
    for (const vol of blueprint.volumes) {
      const volume = await tx.volume.create({
        data: { novelId, sortOrder: vol.sortOrder, title: vol.title, summary: vol.summary },
      });
      for (const ch of vol.chapters) {
        globalOrder++;
        const chapter = await tx.chapter.create({
          data: { novelId, order: globalOrder, title: ch.title, expectation: ch.coreEvent, hook: ch.hook, chapterStatus: "planned" },
        });
        await tx.volumeChapterPlan.create({
          data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: globalOrder, title: ch.title, summary: ch.summary },
        });
      }
    }
  });

  // Generate beat sheets (outside transaction — uses LLM)
  for (const vol of blueprint.volumes) {
    await generateBeatSheet(novelId, vol.sortOrder);
  }
}

/**
 * Get the effective loop count for a novel from its loop skeleton.
 */
export function getEffectiveLoopCount(loopSkeleton: string | null): number {
  if (!loopSkeleton) return 1;
  try {
    const parsed = JSON.parse(loopSkeleton);
    return parsed.totalLoops ?? parsed.loops?.length ?? 1;
  } catch { return 1; }
}
