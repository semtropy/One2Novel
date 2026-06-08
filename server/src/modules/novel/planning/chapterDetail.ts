import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

const DetailSchema = z.object({
  chapters: z.array(z.object({
    chapterOrder: z.number().int(), purpose: z.string(), exclusiveEvent: z.string(),
    endingState: z.string(), conflictLevel: z.number().int().min(1).max(10),
    revealLevel: z.number().int().min(1).max(10), targetWordCount: z.number().int().min(1000).max(8000),
    mustAvoid: z.string().optional(), taskSheet: z.string(),
  })),
});

export async function refineChapterDetails(novelId: string, volumeSortOrder: number) {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { volumes: { where: { sortOrder: volumeSortOrder }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } } } },
  });
  if (!novel || novel.volumes.length === 0) throw new Error("Volume not found");

  const vol = novel.volumes[0];
  const chapters = vol.chapterPlans.map(p => `第${p.chapterOrder}章 ${p.title ?? ""}: ${p.summary ?? ""}`).join("\n");

  const result = await aiInvoke({
    task: "planner",
    systemPrompt: [
      "你是小说创作规划师。为每章生成详细的创作任务单(taskSheet)。",
      "任务单应包含3-5条具体创作指令，每条15-30字，如：开场用对话制造紧张感、确保主角的内心挣扎在本章有可见进展、章尾留下悬念等。",
      "每章还需填写：purpose(目的)、exclusiveEvent(独有事件)、endingState(结束状态)、conflictLevel(冲突1-10)、revealLevel(揭示1-10)、targetWordCount(建议字数)、mustAvoid(必须避免)。",
      "输出JSON。只输出JSON。",
    ].join("\n"),
    userPrompt: `书名：《${novel.title}》\n题材：${novel.genre ?? ""}\n卷：${vol.title}\n概要：${vol.summary ?? ""}\n\n章节列表：\n${chapters}`,
    schema: DetailSchema, temperature: 0.7,
  });

  for (const detail of result.chapters) {
    const plan = vol.chapterPlans.find(p => p.chapterOrder === detail.chapterOrder);
    if (plan) {
      await prisma.volumeChapterPlan.update({
        where: { id: plan.id },
        data: {
          purpose: detail.purpose, exclusiveEvent: detail.exclusiveEvent,
          endingState: detail.endingState, conflictLevel: detail.conflictLevel,
          revealLevel: detail.revealLevel, targetWordCount: detail.targetWordCount,
          mustAvoid: detail.mustAvoid ?? null, taskSheet: detail.taskSheet,
        },
      });
    }
  }
  return result;
}
