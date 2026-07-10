/**
 * Summary Projection Writer — upserts ChapterSummary from committed chapter.
 *
 * Wraps existing generateChapterSummary() from chapterSummary.ts.
 * Also creates StoryEvent records from key events in the summary.
 */

import { getPrisma } from "../../../../../platform/db/client";
import { logEventError } from "../../../../../platform/logging/eventErrorLog";
import { generateChapterSummary } from "../../writing/chapterSummary";

export interface SummaryProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

/**
 * Run summary projection for a committed chapter.
 */
export async function run(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  extractionResult?: Record<string, unknown>,
): Promise<SummaryProjectionResult> {
  const prisma = getPrisma();
  const result: SummaryProjectionResult = {
    itemsProcessed: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsOutdated: 0,
    success: true,
  };

  try {
    // Fetch content if not provided
    let chapterContent = content;
    if (!chapterContent) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { content: true },
      });
      chapterContent = chapter?.content ?? '';
    }

    if (!chapterContent) {
      result.success = false;
      result.error = 'No chapter content available';
      return result;
    }

    // Use existing generateChapterSummary (it persists internally)
    try {
      await generateChapterSummary(novelId, chapterId, chapterContent);
      result.itemsUpdated++;
    } catch (e) {
      logEventError("projection.summaryWriter.generate", { chapterId }, e);
      // Non-fatal: summary generation failure doesn't invalidate the commit
    }

    // Extract key events from existing ChapterSummary for StoryEvent records
    const chapterSummary = await prisma.chapterSummary.findUnique({
      where: { chapterId },
      select: { keyEvents: true },
    });

    if (chapterSummary?.keyEvents) {
      try {
        const keyEvents = JSON.parse(chapterSummary.keyEvents) as string[];
        for (const event of keyEvents) {
          if (typeof event === 'string' && event.trim()) {
            await prisma.storyEvent.create({
              data: {
                novelId,
                chapterOrder,
                chapterCommitId: commitId,
                eventType: 'story_fact',
                subject: event.trim().slice(0, 80),
                newValue: event.trim().slice(0, 2000),
                sourceChapter: chapterOrder,
              },
            });
            result.itemsCreated++;
          }
        }
      } catch { /* keyEvents parse failed — skip */ }
    }

  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    logEventError("projection.summaryWriter", { commitId, novelId, chapterId }, e);
  }

  return result;
}
