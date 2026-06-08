import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";

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
    task: "planner",
    systemPrompt: [
      "你是小说项目立项助手，服务对象是不懂策划、不会拆卖点、也不熟悉网文结构的小白作者。",
      "根据用户已填写的书名、故事概述和少量上下文，补全这本书的书级 framing。",
      "",
      "字段要求：",
      "- targetAudience：目标读者画像，一段话",
      "- commercialTags：3-6个短标签数组",
      "- competingFeel：差异化阅读感受",
      "- bookSellingPoint：核心卖点",
      "- first30ChapterPromise：前30章承诺",
      "- genre：题材（悬疑/言情/奇幻/科幻/历史/都市/武侠/恐怖/其他）",
      "- writingMode：original（原创）或 continuation（续写）",
      "- narrativePov：first_person（第一人称）/ third_person（第三人称）/ mixed（混合）",
      "- pacePreference：slow（舒缓）/ balanced（均衡）/ fast（快节奏）",
      "- styleTone：风格基调，一段话",
      "- emotionIntensity：low（克制）/ medium（适中）/ high（强烈）",
      "",
      "只输出 JSON。",
    ].join("\n"),
    userPrompt: `为以下小说生成书级定位：\n\n${summary}`,
    schema: RawFramingSchema, temperature: 0.8,
  });

  const parseTags = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return v.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    return [];
  };

  return {
    targetAudience: raw.targetAudience ?? "待生成",
    commercialTags: parseTags(raw.commercialTags ?? []),
    competingFeel: raw.competingFeel ?? "待生成",
    bookSellingPoint: raw.bookSellingPoint ?? "待生成",
    first30ChapterPromise: raw.first30ChapterPromise ?? "待生成",
    genre: raw.genre, writingMode: raw.writingMode,
    narrativePov: raw.narrativePov, pacePreference: raw.pacePreference,
    styleTone: raw.styleTone, emotionIntensity: raw.emotionIntensity,
  };
}
