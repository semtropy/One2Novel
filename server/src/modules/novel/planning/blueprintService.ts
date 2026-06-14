import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";
import { getPreferences } from "../../settings/preferences";
import { generateBeatSheet } from "./storyMacro/beatSheetService";

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

/** Generate blueprint (volume→chapter structure) using existing story seed as context. */
export async function generateBlueprint(novelId: string, preferredVolumes?: number): Promise<BlueprintResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Read user preferences for volume count and chapters per volume
  let chaptersPerVolume: number | undefined;
  try {
    const prefs = getPreferences();
    if (!preferredVolumes) preferredVolumes = (prefs?.preferences?.preferredVolumes as number) || undefined;
    chaptersPerVolume = (prefs?.preferences?.preferredChaptersPerVolume as number) || undefined;
  } catch (e) { console.error("[Blueprint prefs]", e instanceof Error ? e.message : e); }

  // Read story core from DraftStorySeed (single source of truth for planning)
  let storyCoreContext = "";
  const draftSeed = await prisma.draftStorySeed.findUnique({ where: { novelId } });
  if (draftSeed?.content) {
    try {
      const seed = JSON.parse(draftSeed.content);
      storyCoreContext = [
        seed.premise ? `前提：${seed.premise}` : null,
        seed.mainArc ? `主线：${seed.mainArc}` : null,
        seed.mysteryBox ? `核心悬念：${seed.mysteryBox}` : null,
        seed.endingDirection ? `结局方向：${seed.endingDirection}` : null,
      ].filter(Boolean).join("\n");
    } catch {}
  }

  const characters = await prisma.draftCharacter.findMany({ where: { novelId }, select: { name: true, role: true, identityLabel: true } });
  const charContext = characters.length > 0
    ? `\n已有角色：${characters.map(c => `${c.name}（${c.role}${c.identityLabel ? `·${c.identityLabel}` : ""}）`).join("、")}`
    : "";

  const context = [
    `书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null,
    novel.description ? `概述：${novel.description.slice(0, 8000)}` : null,
    storyCoreContext,
    charContext,
  ].filter(Boolean).join("\n");

  const targetChapters = novel.estimatedChapterCount || 30;
  const volCount = preferredVolumes && preferredVolumes >= 2 && preferredVolumes <= 8
    ? preferredVolumes
    : Math.max(2, Math.min(8, Math.round(targetChapters / 8)));
  const chPerVol = chaptersPerVolume && chaptersPerVolume >= 2 && chaptersPerVolume <= 100
    ? chaptersPerVolume
    : Math.max(4, Math.min(12, Math.round(targetChapters / volCount)));

  
  const raw = await aiInvoke({
    assetId: "novel.blueprint.generate",
    templateVars: { volCount: String(volCount), chPerVol: String(chPerVol), targetChapters: String(targetChapters) },
    userPrompt: `为以下小说生成章节蓝图：\n\n${context}`,
    schema: BlueprintSchema,
    temperature: 0.8,
  });

  const result: BlueprintResult = {
    volumes: raw.volumes.map((vol, vi) => ({
      sortOrder: vol.volume ?? vi + 1, title: vol.title, summary: vol.theme ?? "",
      chapters: vol.chapters.map((ch, ci) => ({
        order: ch.chapter ?? ci + 1, title: ch.title, summary: ch.summary ?? ch.coreEvent ?? "",
        coreEvent: ch.coreEvent ?? "", hook: ch.hook ?? "", characters: ch.characters ?? [],
        conflictLevel: 5, revealLevel: 5,
      })),
    })),
  };

  // Update estimated chapter count only (blueprint data lives in DraftPlan/Volume tables)
  await prisma.novel.update({
    where: { id: novelId },
    data: {
      estimatedChapterCount: result.volumes.reduce((s, v) => s + v.chapters.length, 0),
    },
  });

  return result;
}
