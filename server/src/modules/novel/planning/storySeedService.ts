import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { getPrisma } from "../../../platform/db/client";

const StorySeedSchema = z.object({
  premise: z.string(),
  mainArc: z.string(),
  mysteryBox: z.string(),
  endingDirection: z.string(),
  genre: z.string().optional(),
  narrativePov: z.string().optional(),
  pacePreference: z.string().optional(),
  styleTone: z.string().optional(),
  emotionIntensity: z.string().optional(),
  targetAudience: z.string().optional(),
  bookSellingPoint: z.string().optional(),
  competingFeel: z.string().optional(),
  first30ChapterPromise: z.string().optional(),
  commercialTags: z.union([z.array(z.string()), z.string()]).optional(),
});

export interface StorySeedResult {
  premise: string;
  mainArc: string;
  mysteryBox: string;
  endingDirection: string;
  genre: string | null;
  narrativePov: string | null;
  pacePreference: string | null;
  styleTone: string | null;
  emotionIntensity: string | null;
  targetAudience: string | null;
  bookSellingPoint: string | null;
  competingFeel: string | null;
  first30ChapterPromise: string | null;
  commercialTags: string[];
}

/** Generate unified story seed: core + creative params + market framing in one LLM call. */
export async function generateStorySeed(novelId: string): Promise<StorySeedResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  const context = [
    `书名：《${novel.title}》`,
    novel.description ? `灵感：${novel.description}` : null,
    novel.genre ? `当前题材：${novel.genre}` : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    "你是资深小说策划编辑，服务对象是不懂策划的小白作者。",
    "你的任务是根据用户提供的一句话灵感（+可选书名/题材），一次性补全故事定位的全部信息。",
    "",
    "【故事核心】（创作者面向，必填，不能留空）",
    "- premise（前提）：主角被困的处境 + 故事根本驱动力。回答「这个故事为什么能开始」。（80-150字）",
    "- mainArc（主线）：贯穿全书的核心剧情线，从起点到终点的变化弧线。回答「这个故事到底讲什么」。（80-150字）",
    "  premise 和 mainArc 必须有本质区别：premise 是初始困局，mainArc 是全程路径与演变。",
    "- mysteryBox（核心悬念）：最关键但暂时无法揭晓的未知，持续牵引读者。回答「读者为什么想知道后面」。（50-100字）",
    "- endingDirection（结局方向）：结局气质与情感落点，不是具体结局细纲。回答「最终走向什么结局」。（50-100字）",
    "",
    "【创作参数】",
    "- genre：题材（悬疑/言情/奇幻/科幻/历史/都市/武侠/恐怖/其他）",
    "- narrativePov：视角（first_person=第一人称/third_person=第三人称/mixed=混合）",
    "- pacePreference：节奏（slow=舒缓/balanced=均衡/fast=快节奏）",
    "- styleTone：风格基调（一段话，50字以内）",
    "- emotionIntensity：情感强度（low=克制/medium=适中/high=强烈）",
    "",
    "【编辑向信息】（可以从故事核心推导，不需要作者手动填写）",
    "- targetAudience：目标读者画像（一段话）",
    "- bookSellingPoint：核心卖点",
    "- competingFeel：差异化阅读感受",
    "- first30ChapterPromise：前30章给读者的承诺",
    "- commercialTags：3-6个短标签数组，如[\"悬疑反转\",\"科幻设定\"]",
    "",
    "生成原则：",
    "1. 优先做冲突重构，不平铺设定。",
    "2. 所有字段服务于「这本书为什么能一直写下去」。",
    "3. 信息不足时给最稳妥克制的结果，但所有字段必须填写，不得留空。",
    "4. 市场字段从故事核心自动推断，不要在叙事字段中塞市场语言。",
    "5. 只输出 JSON，不要 Markdown、解释或额外文本。",
  ].join("\n");

  const raw = await aiInvoke({
    task: "planner",
    systemPrompt,
    userPrompt: `为以下小说生成故事种子：\n\n${context}`,
    schema: StorySeedSchema,
    temperature: 0.8,
  });

  const parseTags = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return v.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    return [];
  };

  const result: StorySeedResult = {
    premise: raw.premise,
    mainArc: raw.mainArc,
    mysteryBox: raw.mysteryBox,
    endingDirection: raw.endingDirection,
    genre: raw.genre ?? novel.genre ?? null,
    narrativePov: raw.narrativePov ?? novel.narrativePov ?? null,
    pacePreference: raw.pacePreference ?? novel.pacePreference ?? null,
    styleTone: raw.styleTone ?? novel.styleTone ?? null,
    emotionIntensity: raw.emotionIntensity ?? novel.emotionIntensity ?? null,
    targetAudience: raw.targetAudience ?? novel.targetAudience ?? null,
    bookSellingPoint: raw.bookSellingPoint ?? novel.bookSellingPoint ?? null,
    competingFeel: raw.competingFeel ?? novel.competingFeel ?? null,
    first30ChapterPromise: raw.first30ChapterPromise ?? novel.first30ChapterPromise ?? null,
    commercialTags: parseTags(raw.commercialTags ?? novel.commercialTags ?? []),
  };

  // Build a structuredOutline with story core + existing volumes if any
  let volumes: unknown[] = [];
  if (novel.structuredOutline) {
    try { const o = JSON.parse(novel.structuredOutline); if (o.volumes) volumes = o.volumes; } catch {}
  }
  const structuredOutline = JSON.stringify({
    premise: result.premise,
    mainArc: result.mainArc,
    mysteryBox: result.mysteryBox,
    endingDirection: result.endingDirection,
    volumes,
  });

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      genre: result.genre,
      narrativePov: result.narrativePov as "first_person" | "third_person" | "mixed" | null,
      pacePreference: result.pacePreference,
      styleTone: result.styleTone,
      emotionIntensity: result.emotionIntensity,
      targetAudience: result.targetAudience,
      bookSellingPoint: result.bookSellingPoint,
      competingFeel: result.competingFeel,
      first30ChapterPromise: result.first30ChapterPromise,
      commercialTags: JSON.stringify(result.commercialTags),
      structuredOutline,
      storylineStatus: "completed",
    },
  });

  return result;
}
