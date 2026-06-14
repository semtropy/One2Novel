import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";

const ChapterDetailSchema = z.object({
  boundary: z.string(),
  purpose: z.string(),
  obligationContract: z.object({
    mustHit: z.array(z.string()),
    mustPreserve: z.array(z.string()),
    mustAvoid: z.array(z.string()),
  }),
  intensityScore: z.number().int().min(1).max(10),
  conflictType: z.string(),
  suggestedWordCount: z.number().int(),
});

export interface ChapterExecutionContract {
  boundary: string;
  purpose: string;
  obligationContract: {
    mustHit: string[];
    mustPreserve: string[];
    mustAvoid: string[];
  };
  intensityScore: number;
  conflictType: string;
  suggestedWordCount: number;
}

export async function generateChapterExecutionContract(
  novelId: string,
  volumeId: string,
  chapterOrder: number,
): Promise<ChapterExecutionContract> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { structuredOutline: true, genre: true },
  });
  const volume = await prisma.volume.findUnique({
    where: { id: volumeId },
    select: { title: true, summary: true, sortOrder: true },
  });

  const userPrompt = [
    `小说题材：${novel?.genre ?? "未指定"}`,
    `卷：${volume?.title ?? ""} — ${volume?.summary ?? ""}`,
    `章节序号：第${chapterOrder}章`,
    novel?.structuredOutline ? `大纲参考：${novel.structuredOutline.slice(0, 2000)}` : "",
    "请生成本章的执行合约。",
  ].filter(Boolean).join("\n");

  return aiInvoke({
    assetId: "novel.volume.chapter-contract",
    userPrompt,
    schema: ChapterDetailSchema,
    temperature: 0.5,
  });
}

/**
 * Compile execution contract into a context block for the writer's chapter_mission group.
 */
export function compileContractContext(contract: ChapterExecutionContract): string {
  return [
    `## 本章执行合约`,
    `边界：${contract.boundary}`,
    `目的：${contract.purpose}`,
    `冲突类型：${contract.conflictType} | 强度：${contract.intensityScore}/10`,
    `建议字数：${contract.suggestedWordCount}`,
    "",
    "### 必达项",
    ...contract.obligationContract.mustHit.map((item, i) => `${i + 1}. ${item}`),
    "",
    "### 必须保留",
    ...contract.obligationContract.mustPreserve.map((item, i) => `${i + 1}. ${item}`),
    "",
    "### 必须避免",
    ...contract.obligationContract.mustAvoid.map((item, i) => `${i + 1}. ${item}`),
  ].join("\n");
}
