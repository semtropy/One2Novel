import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";
import { getPreferences } from "../../settings/preferences";
import { generateBeatSheet } from "./volumeStrategy";

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

  // Extract story core for context (from structuredOutline or live fields)
  let storyCoreContext = "";
  if (novel.structuredOutline) {
    try {
      const o = JSON.parse(novel.structuredOutline);
      storyCoreContext = [
        o.premise ? `前提：${o.premise}` : null,
        o.mainArc ? `主线：${o.mainArc}` : null,
        o.mysteryBox ? `核心悬念：${o.mysteryBox}` : null,
        o.endingDirection ? `结局方向：${o.endingDirection}` : null,
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

  const systemPrompt = [
    "你是资深小说作者+剧情策划编辑。根据已确定的故事核心（前提/主线/悬念/结局方向），生成卷→章结构蓝图。",
    "",
    "核心原则：",
    "1. 卷结构必须服务于前提和主线，每卷有一个明确的阶段目标和主题（填入 theme 字段）。",
    "2. 每章必须填写 coreEvent（核心事件一句话，20-50字）和 hook（章尾悬念钩子，15-30字），以及 summary（章节摘要，20-40字）。这三个字段不能为空。",
    `3. 生成${volCount}卷，每卷约${chPerVol}章，总章数接近${targetChapters}章。章节标题<=8字。`,
    "4. 卷与卷之间形成递进关系：铺垫→升级→高潮→收束。",
    "5. 不要在章节中引入与故事核心矛盾的新设定。",
  ].join("\n");

  const raw = await aiInvoke({
    task: "planner",
    systemPrompt,
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

  // Update structuredOutline: merge story core + new volumes
  let storyCore = {};
  if (novel.structuredOutline) {
    try { const o = JSON.parse(novel.structuredOutline); storyCore = { premise: o.premise, mainArc: o.mainArc, mysteryBox: o.mysteryBox, endingDirection: o.endingDirection }; } catch {}
  }
  const structuredOutline = JSON.stringify({ ...storyCore, volumes: result.volumes });

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      structuredOutline,
      outlineStatus: "completed", storylineStatus: "completed",
      estimatedChapterCount: result.volumes.reduce((s, v) => s + v.chapters.length, 0),
    },
  });

  // Auto-generate beat sheets if volumes exist in DB (after apply)
  const existingVolumes = await prisma.volume.findFirst({ where: { novelId } });
  if (existingVolumes) {
    for (const vol of result.volumes) {
      try { await generateBeatSheet(novelId, vol.sortOrder); } catch {}
    }
  }

  return result;
}
