/**
 * Chapter Summary Service — generates a 200-300 char summary after each chapter write.
 *
 * Uses the user's preferred LLM provider (via aiService.getPreferredProvider)
 * instead of hardcoding a specific provider. Fire-and-forget — failures are logged.
 */

import { getPrisma } from "../../../platform/db/client";
import { getPreferredProvider, getPreferredModel, resolvePrompt } from "../../../platform/llm/aiService";
import { createLLM } from "../../../platform/llm/provider";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export async function generateChapterSummary(
  novelId: string,
  chapterId: string,
  content: string,
): Promise<void> {
  try {
    const prisma = getPrisma();
    const llm = createLLM(getPreferredProvider(), {
      model: getPreferredModel(),
      temperature: 0.3,
      maxTokens: 500,
    });
    const response = await llm.invoke([
      new SystemMessage(resolvePrompt("novel.chapter.summarize")),
      new HumanMessage(content.slice(0, 4000)),
    ]);
    const summary = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
    await prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { novelId, chapterId, summary },
      update: { summary },
    });
  } catch (e) {
    console.error("[ChapterSummary]", e instanceof Error ? e.message : e);
  }
}
