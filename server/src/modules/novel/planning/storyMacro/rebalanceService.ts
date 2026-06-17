import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

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
  /** Number of chapter plans that were actually updated in the database */
  appliedCount: number;
}

export async function rebalanceVolume(novelId: string, volumeId: string): Promise<RebalanceResult> {
  const prisma = getPrisma();
  const volume = await prisma.volume.findUnique({
    where: { id: volumeId },
    include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } },
  });
  const characters = await prisma.novelCharacter.findMany({ where: { novelId } });
  const payoffs = await prisma.payoffLedgerItem.findMany({ where: { novelId } });

  if (!volume) throw new Error("Volume not found");

  const written = volume.chapterPlans.filter(p => p.chapterId).map(p => {
    return `第${p.chapterOrder}章《${p.title}》：${p.summary ?? ""}`;
  }).join("\n");

  const planned = volume.chapterPlans.map(p =>
    `第${p.chapterOrder}章《${p.title}》：${p.summary ?? ""}`).join("\n");

  const result = await aiInvoke({
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

  // Apply changes to database — auto-apply adjusted chapter plans
  let appliedCount = 0;
  try {
    for (const adj of result.adjustedChapters) {
      const plan = volume.chapterPlans.find(p => p.chapterOrder === adj.chapterOrder);
      if (!plan) continue;

      const updateData: Record<string, unknown> = {};
      if (adj.changes.conflictLevel != null) {
        updateData.conflictLevel = Math.max(1, Math.min(10, adj.changes.conflictLevel));
      }
      // Store character scheduling hints in endingState
      if (adj.changes.shouldFeature?.length) {
        updateData.endingState = `建议出场角色: ${adj.changes.shouldFeature.join("、")}`;
      }
      // Append payoff touch notes to purpose
      if (adj.changes.payoffTouches?.length) {
        const existingPurpose = plan.purpose ?? "";
        const payoffNote = `伏笔触点: ${adj.changes.payoffTouches.join("、")}`;
        updateData.purpose = existingPurpose ? `${existingPurpose}; ${payoffNote}` : payoffNote;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.volumeChapterPlan.update({
          where: { id: plan.id },
          data: updateData,
        });
        appliedCount++;
      }
    }
  } catch (e) {
    logEventError("rebalanceVolume.apply", { novelId, volumeId }, e);
    // Don't throw — return LLM results even if DB write failed
  }

  return { ...result, appliedCount };
}
