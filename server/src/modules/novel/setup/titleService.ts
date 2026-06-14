import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";

const TitleItemSchema = z.object({ title: z.string(), reason: z.string() });
const TitleSchema = z.object({ titles: z.array(TitleItemSchema) });

/** Fallback: try to parse as bare array if the wrapped format fails */
function normalizeTitles(raw: unknown): Array<{ title: string; reason: string }> {
  // Try wrapped format first
  const parsed = TitleSchema.safeParse(raw);
  if (parsed.success) return parsed.data.titles;

  // Try bare array
  if (Array.isArray(raw)) {
    const arr = z.array(TitleItemSchema).safeParse(raw);
    if (arr.success) return arr.data;
  }

  // Try object with different key names
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    for (const key of ["titles", "suggestions", "results", "names", "books"]) {
      if (Array.isArray(obj[key])) {
        const arr = z.array(TitleItemSchema).safeParse(obj[key]);
        if (arr.success) return arr.data;
      }
    }
  }

  // If all fails, throw the original schema error
  return TitleSchema.parse(raw).titles;
}

export async function generateTitles(input: { description?: string; genre?: string }) {
  const raw = await aiInvoke({
    assetId: "novel.title.generate",
    userPrompt: `故事描述：${input.description || "暂无"}\n题材：${input.genre || "未指定"}\n请生成5个候选书名。`,
    schema: TitleSchema,
    temperature: 0.9,
  });

  return { titles: normalizeTitles(raw) };
}
