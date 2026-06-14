import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";

const RebalanceOutput = z.object({
  adjustedChapters: z.array(z.object({
    chapterOrder: z.number(),
    changes: z.object({
      conflictLevel: z.number().optional(),
      shouldFeature: z.array(z.string()).optional(),
      payoffTouches: z.array(z.string()).optional(),
    }),
    reason: z.string(),
  })),
  summary: z.string(),
});

export interface RebalanceResult {
  adjustedChapters: Array<{
    chapterOrder: number;
    changes: { conflictLevel?: number; shouldFeature?: string[]; payoffTouches?: string[] };
    reason: string;
  }>;
  summary: string;
}

export async function rebalanceVolume(novelId: string, volumeId: string): Promise<RebalanceResult> {
  const prisma = getPrisma();
  const volume = await prisma.volume.findUnique({
    where: { id: volumeId },
    include: { draftPlans: { orderBy: { chapterOrder: "asc" } }, chapterPlans: { orderBy: { chapterOrder: "asc" } } },
  });
  const characters = await prisma.novelCharacter.findMany({ where: { novelId } });
  const payoffs = await prisma.payoffLedgerItem.findMany({ where: { novelId } });

  if (!volume) throw new Error("Volume not found");

  const written = volume.chapterPlans.filter(p => p.chapterId).map(p => {
    return `第${p.chapterOrder}章《${p.title}》：${p.summary ?? ""}`;
  }).join("\n");

  const planned = volume.draftPlans.map(p =>
    `第${p.chapterOrder}章《${p.title}》：${p.summary ?? ""}`).join("\n");

  return aiInvoke({
    assetId: "novel.volume.rebalance",
    userPrompt: [
      "## 已写章节",
      written || "（尚无）",
      "## 待调整章节",
      planned,
      "## 角色",
      characters.map(c => `${c.name}(${c.role})`).join(", "),
      "## 活跃伏笔",
      payoffs.filter(p => p.currentStatus !== "paid_off").map(p => `${p.title}（${p.currentStatus}）`).join("\n"),
    ].join("\n"),
    schema: RebalanceOutput,
    temperature: 0.5,
  });
}
