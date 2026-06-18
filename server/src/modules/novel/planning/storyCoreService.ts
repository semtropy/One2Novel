import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";
import { serializeTags } from "../../../platform/data/tagHelpers";

const StoryCoreSchema = z.object({
  // Story core
  storySummary: z.string(),
  centralQuestion: z.string(),
  endingDirection: z.string(),
  // Creative params
  genre: z.string().optional(),
  narrativePov: z.string().optional(),
  pacePreference: z.string().optional(),
  tonePitch: z.string().optional(),
  emotionIntensity: z.string().optional(),
  // Commercial framing (merged from deprecated novel.framing.generate)
  targetAudience: z.string().optional(),
  commercialTags: z.array(z.string()).optional(),
  competingFeel: z.string().optional(),
  bookSellingPoint: z.string().optional(),
  first30ChapterPromise: z.string().optional(),
});

export interface StoryCoreResult {
  storySummary: string;
  centralQuestion: string;
  endingDirection: string;
  genre: string | null;
  narrativePov: string | null;
  pacePreference: string | null;
  tonePitch: string | null;
  emotionIntensity: string | null;
  targetAudience: string | null;
  commercialTags: string[] | null;
  competingFeel: string | null;
  bookSellingPoint: string | null;
  first30ChapterPromise: string | null;
}

/**
 * Generate unified story core — story core + creative params + commercial framing.
 * Replaces the old separate story-core.generate + framing.generate with one AI call.
 * Writes directly to Novel columns.
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
    userPrompt: `为以下小说生成故事核心 + 商业定位：\n\n${context}`,
    schema: StoryCoreSchema,
    temperature: 0.8,
    novelId,
  });

  const result: StoryCoreResult = {
    storySummary: raw.storySummary,
    centralQuestion: raw.centralQuestion,
    endingDirection: raw.endingDirection,
    genre: novel.genre ?? raw.genre ?? null,                    // user-set takes priority
    narrativePov: novel.narrativePov ?? raw.narrativePov ?? null,
    pacePreference: novel.pacePreference ?? raw.pacePreference ?? null,
    tonePitch: novel.tonePitch ?? raw.tonePitch ?? null,
    emotionIntensity: novel.emotionIntensity ?? raw.emotionIntensity ?? null,
    targetAudience: raw.targetAudience ?? novel.targetAudience ?? null,
    commercialTags: raw.commercialTags ?? null,
    competingFeel: raw.competingFeel ?? novel.competingFeel ?? null,
    bookSellingPoint: raw.bookSellingPoint ?? novel.bookSellingPoint ?? null,
    first30ChapterPromise: raw.first30ChapterPromise ?? novel.first30ChapterPromise ?? null,
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
      tonePitch: result.tonePitch,
      emotionIntensity: result.emotionIntensity,
      targetAudience: result.targetAudience,
      commercialTags: result.commercialTags ? serializeTags(result.commercialTags) : undefined,
      competingFeel: result.competingFeel,
      bookSellingPoint: result.bookSellingPoint,
      first30ChapterPromise: result.first30ChapterPromise,
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
