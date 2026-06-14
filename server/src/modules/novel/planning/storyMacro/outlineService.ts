import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { getPrisma } from "../../../../platform/db/client";
import { generateBeatSheet } from "./beatSheetService";
import { validateOutline, validateAndSummarize, type ValidationReport } from "./constraintEngine";
import { getStoryCore, generateStoryCore } from "../storyCoreService";

// Note: chapter/volume indices + chapters array are optional with server-side defaults
const LLMChapterSchema = z.object({
  chapter: z.number().int().optional(), title: z.string(), coreEvent: z.string().optional(),
  hook: z.string().optional(), summary: z.string().optional(), characters: z.array(z.string()).optional(),
});
const LLMVolumeSchema = z.object({
  volume: z.number().int().optional(), title: z.string(), theme: z.string().optional(),
  chapters: z.array(LLMChapterSchema).default([]),
});
// Phase 2.1: story core fields are now optional — the LLM focuses on volumes+chapters only
const LLMOutlineSchema = z.object({
  title: z.string().optional(), genre: z.string().optional(), overview: z.string().optional(),
  premise: z.string().optional(), mainArc: z.string().optional(),
  mysteryBox: z.string().optional(), endingDirection: z.string().optional(),
  volumes: z.array(LLMVolumeSchema),
});

export interface StoryOutline {
  premise: string; mainArc: string; mysteryBox: string; endingDirection: string;
  volumes: { sortOrder: number; title: string; summary: string; chapters: { order: number; title: string; summary: string; coreEvent: string; hook: string; characters: string[]; conflictLevel: number; revealLevel: number }[] }[];
  /** Phase 3.2: true if the outline has multiple high-severity structural issues */
  needsRegeneration?: boolean;
}

/** Generate outline and save as preview (structuredOutline). Does NOT modify chapters/volumes. */
export async function generateOutline(novelId: string): Promise<{ outline: StoryOutline; validation: ValidationReport }> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Use shared getStoryCore — reads DraftStorySeed → structuredOutline → null
  let storyCore = await getStoryCore(novelId);
  if (!storyCore) {
    // Auto-generate story core first (user will see it in the story seed panel)
    const core = await generateStoryCore(novelId);
    storyCore = { premise: core.premise, mainArc: core.mainArc, mysteryBox: core.mysteryBox, endingDirection: core.endingDirection };
  }

  const context = [
    `书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null,
    novel.description ? `概述：${novel.description}` : null,
    novel.targetAudience ? `读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `卖点：${novel.bookSellingPoint}` : null,
    "",
    "【已确定的故事核心 — 以此为硬约束生成卷章结构】",
    `前提：${storyCore.premise}`,
    `主线：${storyCore.mainArc}`,
    storyCore.mysteryBox ? `核心悬念：${storyCore.mysteryBox}` : null,
    storyCore.endingDirection ? `结局方向：${storyCore.endingDirection}` : null,
  ].filter(Boolean).join("\n");

  

  const raw = await aiInvoke({
    assetId: "novel.outline.generate", skillModules: ["suspense_levels","suspense_strategy","fatal_flaw","plot_structures"],
    userPrompt: `为以下小说生成完整大纲：\n\n${context}`,
    schema: LLMOutlineSchema, temperature: 0.8,
  });

  // Use existing story core as primary; LLM values serve as fallback only
  const outline: StoryOutline = {
    premise: storyCore.premise,
    mainArc: storyCore.mainArc,
    mysteryBox: storyCore.mysteryBox,
    endingDirection: storyCore.endingDirection,
    volumes: raw.volumes.map((vol, vi) => ({
      sortOrder: vol.volume ?? vi + 1, title: vol.title, summary: vol.theme ?? "",
      chapters: vol.chapters.map((ch, ci) => ({
        order: ch.chapter ?? ci + 1, title: ch.title, summary: ch.summary ?? ch.coreEvent ?? "",
        coreEvent: ch.coreEvent ?? "", hook: ch.hook ?? "", characters: ch.characters ?? [],
        conflictLevel: 5, revealLevel: 5,
      })),
    })),
  };

  // Phase 3.2: Use validateAndSummarize — propagate needsRegeneration to response
  const { report: validation, needsRegeneration } = validateAndSummarize(outline);
  if (needsRegeneration) {
    console.warn(`[Outline] Structure has multiple high-severity violations for novel ${novelId}. Consider re-generating.`);
    outline.needsRegeneration = true;
  }

  // Phase 2.3: Only write structuredOutline (JSON) — removed dead outline Markdown field
  await prisma.novel.update({
    where: { id: novelId },
    data: {
      structuredOutline: JSON.stringify(outline),
      estimatedChapterCount: outline.volumes.reduce((s, v) => s + v.chapters.length, 0),
    },
  });

  return { outline, validation };
}

/** Apply the previewed outline: clear old chapters/volumes and recreate from structuredOutline. */
export async function applyOutline(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel?.structuredOutline) throw new Error("No outline to apply");

  const outline: StoryOutline = JSON.parse(novel.structuredOutline);

  // 1.1: Transaction-protected delete + recreate — rollback on any failure
  await prisma.$transaction(async (tx) => {
    await tx.volumeChapterPlan.deleteMany({ where: { volume: { novelId } } });
    await tx.volume.deleteMany({ where: { novelId } });
    await tx.chapter.deleteMany({ where: { novelId } });

    let globalOrder = 0;
    for (const vol of outline.volumes) {
      const volume = await tx.volume.create({
        data: { novelId, sortOrder: vol.sortOrder, title: vol.title, summary: vol.summary },
      });
      for (const ch of vol.chapters) {
        globalOrder++;
        const chapter = await tx.chapter.create({
          data: { novelId, order: globalOrder, title: ch.title, expectation: ch.coreEvent, hook: ch.hook, chapterStatus: "planned" },
        });
        await tx.volumeChapterPlan.create({
          data: { id: `${volume.id}-${chapter.id}`, volumeId: volume.id, chapterId: chapter.id, chapterOrder: globalOrder, title: ch.title, summary: ch.summary },
        });
      }
    }
  });

  // Generate beat sheets (outside transaction — uses LLM)
  for (const vol of outline.volumes) {
    await generateBeatSheet(novelId, vol.sortOrder);
  }
}
