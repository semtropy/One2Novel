import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { z } from "zod";

const BeatSheetSchema = z.object({
  beats: z.array(z.object({
    chapter: z.number().int(),
    beatType: z.string(),
    goal: z.string(), conflict: z.string(), reveal: z.string(), emotionBeat: z.string(),
  })),
  structureDiagnosis: z.string(),
});

export async function generateBeatSheet(
  novelId: string,
  volumeSortOrder: number,
  options?: { outlineChapters?: Array<{ order: number; title: string; summary: string }> }
) {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { volumes: { where: { sortOrder: volumeSortOrder }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } } } },
  });

  let chapters: string;
  let volTitle: string;
  let volSummary: string;
  let chapterPlans: Array<{ id: string; chapterOrder: number }>;

  if (novel && novel.volumes.length > 0) {
    // DB records exist (after applyOutline)
    const vol = novel.volumes[0];
    volTitle = vol.title;
    volSummary = vol.summary ?? "";
    chapters = vol.chapterPlans.map(p => `第${p.chapterOrder}章 ${p.title ?? ""}: ${p.summary ?? ""}`).join("\n");
    chapterPlans = vol.chapterPlans.map(p => ({ id: p.id, chapterOrder: p.chapterOrder }));
  } else if (options?.outlineChapters && options.outlineChapters.length > 0) {
    // Fallback: use chapters from structuredOutline (preview mode, before apply)
    const outline = JSON.parse(novel?.structuredOutline ?? "{}");
    const vol = (outline.volumes as Array<{ sortOrder: number; title: string; summary: string }> | undefined)
      ?.find(v => v.sortOrder === volumeSortOrder);
    volTitle = vol?.title ?? `第${volumeSortOrder}卷`;
    volSummary = vol?.summary ?? "";
    chapters = options.outlineChapters.map(c => `第${c.order}章 ${c.title}: ${c.summary}`).join("\n");
    chapterPlans = []; // No DB records to update
  } else {
    throw new Error("Volume not found");
  }

  const result = await aiInvoke({
    task: "planner",
    systemPrompt: [
      "你是小说节奏设计师。为卷中的每章分配节奏类型(beatType)：setup=铺垫、progress=推进、pressure=施压、turn=转折、payoff=兑现、cooldown=冷却。",
      "节奏设计原则：",
      "1. 不能连续3章以上同一种beatType，必须形成波浪式起伏。",
      "2. payoff之前必须有足够的setup和pressure铺垫。",
      "3. 卷首通常以setup或progress开始，卷末通常以turn或payoff结束。",
      "4. cooldown章用于高潮后的情绪消化和过渡，不宜过多。",
      "每章给出goal(15-30字)、conflict(15-30字)、reveal(新信息揭示)、emotionBeat(情绪基调)。",
      "最后给出structureDiagnosis(50-100字)，诊断本卷节奏是否合理。",
      "",
      "beats数组必须包含每一章，不能跳过或遗漏。",
    ].join("\n"),
    userPrompt: `书名：《${novel?.title ?? ""}》\n题材：${novel?.genre ?? ""}\n卷：${volTitle}\n概要：${volSummary}\n\n章节：\n${chapters}`,
    schema: BeatSheetSchema,
  });

  // Persist to DB only if chapterPlans exist
  for (const beat of result.beats) {
    const plan = chapterPlans.find(p => p.chapterOrder === beat.chapter);
    if (plan) {
      await prisma.volumeChapterPlan.update({
        where: { id: plan.id },
        data: {
          purpose: beat.goal, conflictLevel: beat.beatType === "pressure"||beat.beatType==="turn"?8:beat.beatType==="cooldown"?3:5,
          revealLevel: beat.beatType==="turn"||beat.beatType==="payoff"?8:beat.beatType==="setup"?3:5,
          taskSheet: JSON.stringify({ conflict: beat.conflict, reveal: beat.reveal, emotionBeat: beat.emotionBeat }),
        },
      });
    }
  }
  return result;
}
