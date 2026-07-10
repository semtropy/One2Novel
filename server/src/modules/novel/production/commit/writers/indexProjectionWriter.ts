/**
 * Index Projection Writer — updates VolumeChapterPlan and entity relationships.
 *
 * Processes entity_deltas into relationship records and updates chapter plan
 * metadata based on the committed chapter.
 */

import { getPrisma } from "../../../../../platform/db/client";
import { logEventError } from "../../../../../platform/logging/eventErrorLog";

export interface IndexProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

/**
 * Run index projection for a committed chapter.
 */
export async function run(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  extractionResult?: Record<string, unknown>,
): Promise<IndexProjectionResult> {
  const prisma = getPrisma();
  const result: IndexProjectionResult = {
    itemsProcessed: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsOutdated: 0,
    success: true,
  };

  try {
    // Process entity deltas into relationship records
    const entityDeltas = extractionResult?.entity_deltas as Array<{
      name?: string;
      fromEntity?: string;
      toEntity?: string;
      flags?: Record<string, unknown>;
    }> | undefined;

    if (entityDeltas) {
      for (const entity of entityDeltas) {
        result.itemsProcessed++;

        // Create relationship if from/to entities exist
        if (entity.fromEntity && entity.toEntity) {
          const sourceChar = await prisma.novelCharacter.findFirst({
            where: { novelId, name: entity.fromEntity },
            select: { id: true },
          });
          const targetChar = await prisma.novelCharacter.findFirst({
            where: { novelId, name: entity.toEntity },
            select: { id: true },
          });

          if (sourceChar && targetChar) {
            // Check if relationship already exists
            const existing = await prisma.novelCharacterRelation.findFirst({
              where: {
                novelId,
                sourceCharacterId: sourceChar.id,
                targetCharacterId: targetChar.id,
              },
            });

            if (!existing) {
              await prisma.novelCharacterRelation.create({
                data: {
                  novelId,
                  sourceCharacterId: sourceChar.id,
                  targetCharacterId: targetChar.id,
                  type: 'acquainted',
                  historySummary: `Met in chapter ${chapterOrder}`,
                },
              });
              result.itemsCreated++;
            }
          }
        }
      }
    }

    // Update VolumeChapterPlan with chapter content insights
    // (In Phase 4, this would be driven by extractionResult.contentBeat insights)
    const volPlan = await prisma.volumeChapterPlan.findFirst({
      where: { chapterId: chapterId ?? undefined },
    });

    if (volPlan) {
      // Refine chapter type based on content length and structure
      const wordCount = content?.replace(/<[^>]*>/g, '').length ?? 0;
      if (wordCount > 4000 && volPlan.chapterType !== 'climax') {
        await prisma.volumeChapterPlan.update({
          where: { id: volPlan.id },
          data: { chapterType: 'advance' },
        });
        result.itemsUpdated++;
      }
    }

  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    logEventError("projection.indexWriter", { commitId, novelId, chapterId }, e);
  }

  return result;
}
