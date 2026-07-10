/**
 * Memory Projection Writer — upserts MemoryItem records from committed chapter.
 *
 * Replaces the functionality of memoryWriter.ts but invoked from the
 * projection engine instead of the post-write bus. Receives extractionResult
 * and upserts MemoryItem records with the same deduplication logic.
 */

import { getPrisma } from "../../../../../platform/db/client";
import { logEventError } from "../../../../../platform/logging/eventErrorLog";

export interface MemoryProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

/**
 * Run memory projection for a committed chapter.
 */
export async function run(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  extractionResult?: Record<string, unknown>,
): Promise<MemoryProjectionResult> {
  const prisma = getPrisma();
  const result: MemoryProjectionResult = {
    itemsProcessed: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsOutdated: 0,
    success: true,
  };

  try {
    const stateDeltas = extractionResult?.state_deltas as Array<{
      characterName?: string;
      name?: string;
      field?: string;
      newValue?: string;
    }> | undefined;

    const entityDeltas = extractionResult?.entity_deltas as Array<{
      name?: string;
      fromEntity?: string;
      toEntity?: string;
    }> | undefined;

    const acceptedEvents = extractionResult?.accepted_events as Array<{
      type?: string;
      subject?: string;
      memory_facts?: {
        timeline_events?: string[];
        world_rules?: string[];
        open_loops?: string[];
        reader_promises?: string[];
      };
    }> | undefined;

    // 1. State deltas → character_state
    if (stateDeltas) {
      for (const delta of stateDeltas) {
        const name = delta.characterName || delta.name;
        if (!name || !delta.field || !delta.newValue) continue;

        await upsertMemoryItem(prisma, novelId, {
          category: 'character_state',
          subject: name.slice(0, 200),
          field: delta.field.slice(0, 100),
          value: delta.newValue.slice(0, 2000),
          sourceChapter: chapterOrder,
          payload: { source: 'projection', commitId },
        }, result);
      }
    }

    // 2. Entity deltas → first_seen, relationship
    if (entityDeltas) {
      for (const entity of entityDeltas) {
        if (!entity.name) continue;

        // first_seen
        await upsertMemoryItem(prisma, novelId, {
          category: 'character_state',
          subject: entity.name.slice(0, 200),
          field: 'first_seen',
          value: `Chapter ${chapterOrder}`,
          sourceChapter: chapterOrder,
          payload: { source: 'projection' },
        }, result);

        // relationship
        if (entity.fromEntity && entity.toEntity) {
          await upsertMemoryItem(prisma, novelId, {
            category: 'relationship',
            subject: entity.fromEntity.slice(0, 200),
            field: entity.toEntity.slice(0, 200),
            value: 'connected',
            sourceChapter: chapterOrder,
            payload: { source: 'projection' },
          }, result);
        }
      }
    }

    // 3. Events → story_fact, world_rule, open_loop, reader_promise
    if (acceptedEvents) {
      for (const evt of acceptedEvents) {
        if (!evt.subject) continue;

        // story_fact from event subject
        await upsertMemoryItem(prisma, novelId, {
          category: 'story_fact',
          subject: evt.subject.slice(0, 200),
          field: 'event',
          value: evt.subject.slice(0, 2000),
          sourceChapter: chapterOrder,
          payload: { source: 'projection', eventType: evt.type },
        }, result);

        // memory_facts from event
        if (evt.memory_facts) {
          const mf = evt.memory_facts;
          if (mf.timeline_events) {
            for (const te of mf.timeline_events) {
              if (te.trim()) {
                await upsertMemoryItem(prisma, novelId, {
                  category: 'timeline',
                  subject: te.trim().slice(0, 80),
                  field: 'event',
                  value: te.trim().slice(0, 2000),
                  sourceChapter: chapterOrder,
                  payload: { source: 'projection' },
                }, result);
              }
            }
          }
          if (mf.world_rules) {
            for (const wr of mf.world_rules) {
              if (wr.trim()) {
                await upsertMemoryItem(prisma, novelId, {
                  category: 'world_rule',
                  subject: wr.trim().slice(0, 60),
                  field: 'rule_content',
                  value: wr.trim().slice(0, 2000),
                  sourceChapter: chapterOrder,
                  payload: { source: 'projection' },
                }, result);
              }
            }
          }
          if (mf.open_loops) {
            for (const ol of mf.open_loops) {
              if (ol.trim()) {
                await upsertMemoryItem(prisma, novelId, {
                  category: 'open_loop',
                  subject: ol.trim().slice(0, 80),
                  field: 'status',
                  value: 'pending',
                  sourceChapter: chapterOrder,
                  payload: { source: 'projection', type: 'open_loop' },
                }, result);
              }
            }
          }
          if (mf.reader_promises) {
            for (const rp of mf.reader_promises) {
              if (rp.trim()) {
                await upsertMemoryItem(prisma, novelId, {
                  category: 'reader_promise',
                  subject: rp.trim().slice(0, 80),
                  field: 'promise',
                  value: rp.trim().slice(0, 2000),
                  sourceChapter: chapterOrder,
                  payload: { source: 'projection' },
                }, result);
              }
            }
          }
        }
      }
    }

  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    logEventError("projection.memoryWriter", { commitId, novelId, chapterId }, e);
  }

  return result;
}

/**
 * Upsert a single MemoryItem with deduplication.
 * Same-key existing items are marked "outdated".
 */
async function upsertMemoryItem(
  prisma: ReturnType<typeof getPrisma>,
  novelId: string,
  item: {
    category: string;
    subject: string;
    field: string;
    value: string;
    sourceChapter: number;
    payload?: Record<string, unknown>;
  },
  result: MemoryProjectionResult,
): Promise<void> {
  const { category, subject, field, value, sourceChapter, payload } = item;

  if (!value || !value.trim()) return;

  try {
    const existing = await prisma.memoryItem.findUnique({
      where: {
        novelId_category_subject_field: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
        },
      },
      select: { id: true, status: true },
    });

    if (existing && existing.status === 'active') {
      await prisma.memoryItem.updateMany({
        where: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
          status: 'active',
        },
        data: { status: 'outdated' },
      });
      result.itemsOutdated++;
    }

    await prisma.memoryItem.upsert({
      where: {
        novelId_category_subject_field: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
        },
      },
      create: {
        novelId,
        category,
        subject: subject.slice(0, 200),
        field: field.slice(0, 100),
        value: value.slice(0, 2000),
        sourceChapter,
        payload: payload ? JSON.stringify(payload) : null,
      },
      update: {
        value: value.slice(0, 2000),
        sourceChapter,
        status: 'active',
        payload: payload ? JSON.stringify(payload) : undefined,
      },
    });

    result.itemsUpdated += existing ? 1 : 0;
    result.itemsCreated += existing ? 0 : 1;
  } catch (e) {
    logEventError("projection.memoryWriter.upsert", { novelId, category, subject, field }, e);
  }
}
