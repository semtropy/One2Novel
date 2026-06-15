/**
 * Chapter Summary Service — generates a 200-300 char summary after each chapter write.
 *
 * Migrated to use aiInvoke (unified LLM invocation) instead of direct LangChain calls.
 * Fire-and-forget — failures are logged via logEventError.
 */
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { z } from "zod";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { getPreferredProvider } from "../../../../platform/llm/aiService";

const SummarySchema = z.object({ summary: z.string() });

export async function generateChapterSummary(
  novelId: string,
  chapterId: string,
  content: string,
): Promise<void> {
  try {
    const result = await aiInvoke({
      assetId: "novel.chapter.summarize",
      userPrompt: content.slice(0, 4000),
      schema: SummarySchema,
      temperature: 0.3,
      maxTokens: 500,
      novelId,
      chapterId,
    });

    const prisma = getPrisma();
    await prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { novelId, chapterId, summary: result.summary },
      update: { summary: result.summary },
    });
  } catch (e) {
    logEventError("chapterSummary", { novelId, chapterId }, e);
  }
}
