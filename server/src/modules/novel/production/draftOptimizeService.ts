import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

const OptimizeOutput = z.object({
  optimizedContent: z.string(),
  changesSummary: z.string(),
  preservedElements: z.array(z.string()),
});

export async function optimizeChapterDraft(
  novelId: string,
  chapterId: string,
): Promise<{ optimizedContent: string; changesSummary: string; preservedElements: string[] }> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) throw new Error("Chapter has no content");

  const recentChapters = await prisma.chapter.findMany({
    where: { novelId, order: { lt: chapter.order }, chapterStatus: "completed" },
    orderBy: { order: "desc" }, take: 1,
  });

  return aiInvoke({
    assetId: "novel.chapter.optimize",
    userPrompt: [
      `待优化章节：第${chapter.order}章《${chapter.title}》`,
      `章节预期：${chapter.expectation ?? ""}`,
      `上一章结尾：${recentChapters[0]?.content?.slice(-300) ?? "无"}`,
      `正文：\n${chapter.content.slice(0, 8000)}`,
    ].join("\n"),
    schema: OptimizeOutput,
    temperature: 0.6,
    maxTokens: 8192,
  });
}
