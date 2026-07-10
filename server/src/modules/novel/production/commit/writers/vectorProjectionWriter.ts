/**
 * Vector Projection Writer — stores chapter content in RAG for semantic search.
 *
 * Wraps existing rag.storeChapter() from the post-write bus.
 * Collects chunks from commit: summary, events, entity deltas, scenes.
 * Generates deterministic chunk_ids via hash.
 */

import { getPrisma } from "../../../../../platform/db/client";
import { logEventError } from "../../../../../platform/logging/eventErrorLog";

export interface VectorProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

/**
 * Run vector projection for a committed chapter.
 */
export async function run(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  extractionResult?: Record<string, unknown>,
): Promise<VectorProjectionResult> {
  const prisma = getPrisma();
  const result: VectorProjectionResult = {
    itemsProcessed: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsOutdated: 0,
    success: true,
  };

  try {
    // Fetch chapter content if not provided
    if (!content) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { content: true },
      });
      if (!chapter) {
        result.success = false;
        result.error = 'Chapter not found';
        return result;
      }
      content = chapter.content ?? '';
    }

    if (!content) {
      result.success = false;
      result.error = 'No chapter content available';
      return result;
    }

    // Fetch the RAG service and store chapter
    const { getRAGService } = await import("../../../../../platform/rag/ragService");
    const rag = getRAGService();

    // Get summary if available
    const summary = extractionResult?.summary_text as string | undefined;

    await rag.storeChapter(chapterOrder, 'unknown', content, summary);
    result.itemsProcessed++;
    result.itemsUpdated++;

    // Also store event chunks if available
    const acceptedEvents = (extractionResult?.accepted_events as Array<{
      type?: string;
      subject?: string;
      newValue?: string;
    }> | undefined) ?? [];

    if (acceptedEvents.length > 0) {
      for (const evt of acceptedEvents) {
        if (evt.subject && evt.newValue) {
          const eventText = `[${evt.type ?? 'event'}] ${evt.subject}: ${evt.newValue}`;
          await rag.storeChapter(chapterOrder, 'event', eventText.slice(0, 2000));
          result.itemsProcessed++;
          result.itemsCreated++;
        }
      }
    }

  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    logEventError("projection.vectorWriter", { commitId, novelId, chapterId }, e);
  }

  return result;
}
