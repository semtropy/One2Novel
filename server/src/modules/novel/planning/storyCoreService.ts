import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";

const StoryCoreSchema = z.object({
  premise: z.string(),
  mainArc: z.string(),
  mysteryBox: z.string(),
  endingDirection: z.string(),
  genre: z.string().optional(),
  narrativePov: z.string().optional(),
  pacePreference: z.string().optional(),
  styleTone: z.string().optional(),
  emotionIntensity: z.string().optional(),
});

export interface StoryCoreResult {
  premise: string;
  mainArc: string;
  mysteryBox: string;
  endingDirection: string;
  genre: string | null;
  narrativePov: string | null;
  pacePreference: string | null;
  styleTone: string | null;
  emotionIntensity: string | null;
}

/**
 * Generate story core (premise/mainArc/mysteryBox/endingDirection + creative params).
 * Writes to Novel.draftSeed (not structuredOutline) — consistent with DraftPlan/DraftCharacter pattern.
 */
export async function generateStoryCore(novelId: string): Promise<StoryCoreResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  const context = [
    `书名：《${novel.title}》`,
    novel.description ? `灵感：${novel.description}` : null,
    novel.genre ? `当前题材：${novel.genre}` : null,
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    assetId: "novel.story-core.generate",
    userPrompt: `为以下小说生成故事核心：\n\n${context}`,
    schema: StoryCoreSchema,
    temperature: 0.8,
  });

  const result: StoryCoreResult = {
    premise: raw.premise,
    mainArc: raw.mainArc,
    mysteryBox: raw.mysteryBox,
    endingDirection: raw.endingDirection,
    genre: raw.genre ?? novel.genre ?? null,
    narrativePov: raw.narrativePov ?? novel.narrativePov ?? null,
    pacePreference: raw.pacePreference ?? novel.pacePreference ?? null,
    styleTone: raw.styleTone ?? novel.styleTone ?? null,
    emotionIntensity: raw.emotionIntensity ?? novel.emotionIntensity ?? null,
  };

  // Write story core to DraftStorySeed (single source of truth for planning)
  const draftSeedContent = JSON.stringify({
    premise: result.premise,
    mainArc: result.mainArc,
    mysteryBox: result.mysteryBox,
    endingDirection: result.endingDirection,
  });

  await prisma.draftStorySeed.upsert({
    where: { novelId },
    create: { novelId, content: draftSeedContent },
    update: { content: draftSeedContent, synced: false },
  });

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      genre: result.genre,
      narrativePov: result.narrativePov as "first_person" | "third_person" | "mixed" | null,
      pacePreference: result.pacePreference,
      styleTone: result.styleTone,
      emotionIntensity: result.emotionIntensity,
    },
  });

  return result;
}

/**
 * Read story core from DraftStorySeed (single source of truth for planning).
 * Falls back to structuredOutline for legacy novels. Returns null if neither exists.
 */
export async function getStoryCore(novelId: string): Promise<{
  premise: string; mainArc: string; mysteryBox: string; endingDirection: string;
} | null> {
  const prisma = getPrisma();
  const draftSeed = await prisma.draftStorySeed.findUnique({ where: { novelId } });
  if (draftSeed?.content) {
    try {
      const parsed = JSON.parse(draftSeed.content);
      if (parsed.premise || parsed.mainArc) return {
        premise: parsed.premise ?? "",
        mainArc: parsed.mainArc ?? "",
        mysteryBox: parsed.mysteryBox ?? "",
        endingDirection: parsed.endingDirection ?? "",
      };
    } catch { /* fall through */ }
  }
  return null;
}
