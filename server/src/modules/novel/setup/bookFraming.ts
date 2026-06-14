import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { parseTags } from "../../../platform/data/tagHelpers";

const RawFramingSchema = z.object({
  targetAudience: z.string().optional(), commercialTags: z.union([z.array(z.string()), z.string()]).optional(),
  competingFeel: z.string().optional(), bookSellingPoint: z.string().optional(),
  first30ChapterPromise: z.string().optional(),
  genre: z.string().optional(), writingMode: z.string().optional(),
  narrativePov: z.string().optional(), pacePreference: z.string().optional(),
  styleTone: z.string().optional(), emotionIntensity: z.string().optional(),
}).passthrough();

export interface BookFramingResult {
  targetAudience: string; commercialTags: string[]; competingFeel: string;
  bookSellingPoint: string; first30ChapterPromise: string;
  genre?: string; writingMode?: string; narrativePov?: string;
  pacePreference?: string; styleTone?: string; emotionIntensity?: string;
}

export async function generateBookFraming(input: { title: string; description?: string; genre?: string }): Promise<BookFramingResult> {
  const summary = [
    `书名：《${input.title}》`, input.genre ? `题材：${input.genre}` : null,
    input.description ? `概述：${input.description}` : "概述：暂无",
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    assetId: "novel.framing.generate",
    userPrompt: `为以下小说生成书级定位：\n\n${summary}`,
    schema: RawFramingSchema, temperature: 0.8,
  });

  return {
    targetAudience: raw.targetAudience ?? "待生成",
    commercialTags: Array.isArray(raw.commercialTags) ? raw.commercialTags : (typeof raw.commercialTags === "string" ? parseTags(raw.commercialTags) : []),
    competingFeel: raw.competingFeel ?? "待生成",
    bookSellingPoint: raw.bookSellingPoint ?? "待生成",
    first30ChapterPromise: raw.first30ChapterPromise ?? "待生成",
    genre: raw.genre, writingMode: raw.writingMode,
    narrativePov: raw.narrativePov, pacePreference: raw.pacePreference,
    styleTone: raw.styleTone, emotionIntensity: raw.emotionIntensity,
  };
}
