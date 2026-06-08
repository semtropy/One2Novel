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

  const systemPrompt = [
    "你是资深小说策划编辑。根据用户提供的一句话灵感（+可选书名/题材），补全故事核心定位。",
    "",
    "字段说明：",
    "- premise（前提）：主角被困的处境 + 故事根本驱动力。回答「这个故事为什么能开始」。（80-150字）",
    "- mainArc（主线）：贯穿全书的核心剧情线，从起点到终点的变化弧线。回答「这个故事到底讲什么」。（80-150字）",
    "  premise 和 mainArc 必须有本质区别：premise 是初始困局，mainArc 是全程路径与演变。",
    "- mysteryBox（核心悬念）：最关键但暂时无法揭晓的未知，持续牵引读者。回答「读者为什么想知道后面」。（50-100字）",
    "- endingDirection（结局方向）：结局气质与情感落点。回答「最终走向什么结局」。（50-100字）",
    "- genre：题材（悬疑/言情/奇幻/科幻/历史/都市/武侠/恐怖/其他）",
    "- narrativePov：视角（first_person=第一人称/third_person=第三人称/mixed=混合）",
    "- pacePreference：节奏（slow=舒缓/balanced=均衡/fast=快节奏）",
    "- styleTone：风格基调（一段话，50字以内）",
    "- emotionIntensity：情感强度（low=克制/medium=适中/high=强烈）",
    "",
    "生成原则：",
    "1. 优先做冲突重构，不平铺设定。",
    "2. 所有字段服务于「这本书为什么能一直写下去」。",
    "3. 信息不足时给最稳妥克制的结果，但所有字段必须填写，不得留空。",
    "4. 不要输出 Markdown、解释或额外文本。",
  ].join("\n");

  const raw = await aiInvoke({
    task: "planner",
    systemPrompt,
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
      storylineStatus: "completed",
    },
  });

  return result;
}
