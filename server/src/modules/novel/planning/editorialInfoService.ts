import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";

const EditorialInfoSchema = z.object({
  targetAudience: z.string(),
  bookSellingPoint: z.string(),
  competingFeel: z.string(),
  first30ChapterPromise: z.string(),
  commercialTags: z.array(z.string()),
});

export interface EditorialInfoResult {
  targetAudience: string;
  bookSellingPoint: string;
  competingFeel: string;
  first30ChapterPromise: string;
  commercialTags: string[];
}

/**
 * Generate editorial/market info independently from story core.
 * Reads story core context from draftSeed or structuredOutline, writes to Novel columns.
 */
export async function generateEditorialInfo(novelId: string): Promise<EditorialInfoResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Extract story core context from draftSeed or structuredOutline
  let storyContext = "";
  const draftSeed = await prisma.draftStorySeed.findUnique({ where: { novelId } });
  const seedSource = draftSeed?.content ?? novel.structuredOutline;
  if (seedSource) {
    try {
      const o = JSON.parse(seedSource);
      storyContext = [
        o.premise ? `前提：${o.premise}` : null,
        o.mainArc ? `主线：${o.mainArc}` : null,
        o.mysteryBox ? `核心悬念：${o.mysteryBox}` : null,
        o.endingDirection ? `结局方向：${o.endingDirection}` : null,
      ].filter(Boolean).join("\n");
    } catch {}
  }

  const context = [
    `书名：《${novel.title}》`,
    novel.genre ? `题材：${novel.genre}` : null,
    novel.description ? `灵感：${novel.description}` : null,
    storyContext,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    "你是资深小说市场策划编辑。根据故事核心，推导编辑向的市场定位信息。",
    "",
    "字段说明：",
    "- targetAudience：目标读者画像（一段话，描述谁会看这本书、为什么）",
    "- bookSellingPoint：核心卖点（一段话，读者为什么要点进来、追读）",
    "- competingFeel：差异化阅读感受（一段话，和同类书有什么不同的体验）",
    "- first30ChapterPromise：前30章给读者的承诺（读完前30章能得到什么）",
    "- commercialTags：3-6个短标签数组，如[\"悬疑反转\",\"科幻设定\",\"职场博弈\"]",
    "",
    "生成原则：",
    "1. 市场字段从故事核心自动推导，不要在标签中塞叙事语言。",
    "2. 所有字段必须填写，不得留空。",
    "3. 信息不足时给最稳妥克制的结果。",
    "4. 不要输出 Markdown、解释或额外文本。",
  ].join("\n");

  const raw = await aiInvoke({
    task: "planner",
    systemPrompt,
    userPrompt: `为以下小说生成编辑向信息：\n\n${context}`,
    schema: EditorialInfoSchema,
    temperature: 0.7,
  });

  const result: EditorialInfoResult = {
    targetAudience: raw.targetAudience,
    bookSellingPoint: raw.bookSellingPoint,
    competingFeel: raw.competingFeel,
    first30ChapterPromise: raw.first30ChapterPromise,
    commercialTags: raw.commercialTags,
  };

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      targetAudience: result.targetAudience,
      bookSellingPoint: result.bookSellingPoint,
      competingFeel: result.competingFeel,
      first30ChapterPromise: result.first30ChapterPromise,
      commercialTags: JSON.stringify(result.commercialTags),
    },
  });

  return result;
}
