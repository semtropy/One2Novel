import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";

const StoryCoreSchema = z.object({
  storySummary: z.string(),
  centralQuestion: z.string(),
  endingDirection: z.string(),
  genre: z.string().optional(),
  narrativePov: z.string().optional(),
  pacePreference: z.string().optional(),
  styleTone: z.string().optional(),
  emotionIntensity: z.string().optional(),
});

export interface StoryCoreResult {
  storySummary: string;
  centralQuestion: string;
  endingDirection: string;
  genre: string | null;
  narrativePov: string | null;
  pacePreference: string | null;
  styleTone: string | null;
  emotionIntensity: string | null;
}

/**
 * Generate story core (storySummary / centralQuestion / endingDirection + creative params).
 * Writes directly to Novel columns — no more DraftStorySeed indirection.
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
    novelId,
  });

  const result: StoryCoreResult = {
    storySummary: raw.storySummary,
    centralQuestion: raw.centralQuestion,
    endingDirection: raw.endingDirection,
    genre: raw.genre ?? novel.genre ?? null,
    narrativePov: raw.narrativePov ?? novel.narrativePov ?? null,
    pacePreference: raw.pacePreference ?? novel.pacePreference ?? null,
    styleTone: raw.styleTone ?? novel.styleTone ?? null,
    emotionIntensity: raw.emotionIntensity ?? novel.emotionIntensity ?? null,
  };

  // Write directly to Novel columns
  await prisma.novel.update({
    where: { id: novelId },
    data: {
      storySummary: result.storySummary,
      centralQuestion: result.centralQuestion,
      endingDirection: result.endingDirection,
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
 * Read story core directly from Novel columns.
 * Returns null if storySummary is empty (not yet generated).
 */
export async function getStoryCore(novelId: string): Promise<{
  storySummary: string; centralQuestion: string; endingDirection: string;
} | null> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { storySummary: true, centralQuestion: true, endingDirection: true },
  });
  if (!novel?.storySummary) return null;
  return {
    storySummary: novel.storySummary,
    centralQuestion: novel.centralQuestion ?? "",
    endingDirection: novel.endingDirection ?? "",
  };
}
