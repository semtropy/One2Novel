/**
 * State Projection Writer — updates character state, entity lifecycle,
 * and entity deltas from a committed chapter.
 *
 * Merges the work of characterStateUpdater.ts and entityLifecycle.ts:
 * - Writes EntityStateJournal entries for each state change
 * - Updates EntityLifecycle (death/revival tracking)
 * - Updates NovelCharacter fields (currentStatus, currentLocation, currentGoal)
 * - Creates StoryEvent records for state changes
 */

import { getPrisma } from "../../../../../platform/db/client";
import { logEventError } from "../../../../../platform/logging/eventErrorLog";
import { aiInvoke } from "../../../../../platform/llm/aiService";
import { REF_PROMPT_SLICE_LARGE } from "../../../../../platform/config/constants";
import { z } from "zod";

export interface StateProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

const CharacterPostChapterSchema = z.object({
  updates: z.array(z.object({
    characterName: z.string(),
    currentStatus: z.string().optional(),
    currentLocation: z.string().optional(),
    currentGoal: z.string().optional(),
    availability: z.string().optional(),
  })).max(20).default([]),
});

/**
 * Run state projection for a committed chapter.
 *
 * If extractionResult contains state_deltas, uses those directly.
 * Otherwise falls back to LLM extraction from chapter content.
 */
export async function run(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  extractionResult?: Record<string, unknown>,
): Promise<StateProjectionResult> {
  const prisma = getPrisma();
  const result: StateProjectionResult = {
    itemsProcessed: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsOutdated: 0,
    success: true,
  };

  try {
    let stateDeltas: Array<{
      characterName: string;
      field: string;
      oldValue?: string;
      newValue: string;
    }> = [];
    let entityDeltas: Array<{
      name: string;
      flags?: Record<string, unknown>;
    }> = [];
    let acceptedEvents: Array<{ type?: string; subject?: string; field?: string; oldValue?: string; newValue: string }> = [];

    // Extract from extractionResult if available
    if (extractionResult) {
      const deltas = extractionResult.state_deltas as Array<{
        characterName?: string;
        name?: string;
        field?: string;
        oldValue?: string;
        newValue?: string;
      }> | undefined;
      if (deltas && Array.isArray(deltas)) {
        for (const d of deltas) {
          const name = d.characterName || d.name;
          if (name && d.field && d.newValue) {
            stateDeltas.push({
              characterName: name,
              field: d.field,
              oldValue: d.oldValue,
              newValue: d.newValue,
            });
          }
        }
      }

      const ents = extractionResult.entity_deltas as Array<{
        name?: string;
        flags?: Record<string, unknown>;
      }> | undefined;
      if (ents && Array.isArray(ents)) {
        entityDeltas = ents.filter((e): e is { name: string; flags?: Record<string, unknown> } => !!e.name);
      }

      const events = extractionResult.accepted_events as Array<{
        type?: string;
        subject?: string;
        field?: string;
        oldValue?: string;
        newValue?: string;
      }> | undefined;
      if (events && Array.isArray(events)) {
        acceptedEvents = events.filter((e): e is { type?: string; subject?: string; field?: string; oldValue?: string; newValue: string } => !!(e.type && e.subject && e.newValue));
      }
    }

    // If no deltas from extraction, fall back to LLM
    if (stateDeltas.length === 0 && content) {
      const llmResult = await extractStatesFromContent(novelId, chapterId, chapterOrder, content);
      if (llmResult) {
        for (const u of llmResult.updates) {
          if (u.currentStatus) {
            stateDeltas.push({
              characterName: u.characterName,
              field: 'currentStatus',
              newValue: u.currentStatus,
            });
          }
          if (u.currentLocation) {
            stateDeltas.push({
              characterName: u.characterName,
              field: 'currentLocation',
              newValue: u.currentLocation,
            });
          }
          if (u.currentGoal) {
            stateDeltas.push({
              characterName: u.characterName,
              field: 'currentGoal',
              newValue: u.currentGoal,
            });
          }
        }
      }
    }

    // Batch-fetch all characters once (O(N) instead of O(N*M))
    const allCharacters = await prisma.novelCharacter.findMany({
      where: { novelId },
      select: { id: true, name: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });
    const charByName = new Map(allCharacters.map(c => [c.name, c]));

    // Apply state deltas
    for (const delta of stateDeltas) {
      result.itemsProcessed++;

      const character = charByName.get(delta.characterName);
      if (!character) continue;

      // Write EntityStateJournal entry
      await prisma.entityStateJournal.create({
        data: {
          novelId,
          characterId: character.id,
          field: delta.field,
          oldValue: delta.oldValue ?? null,
          newValue: delta.newValue.slice(0, 2000),
          changedAtChapter: chapterOrder,
          confidence: 0.9,
          reason: `Projected from commit ${commitId}`,
        },
      });
      result.itemsCreated++;

      // Update NovelCharacter field
      const fieldMap: Record<string, string> = {
        currentStatus: 'currentStatus',
        currentLocation: 'currentLocation',
        currentGoal: 'currentGoal',
        availability: 'availability',
      };
      const prismaField = fieldMap[delta.field];
      if (prismaField) {
        await prisma.novelCharacter.update({
          where: { id: character.id },
          data: { [prismaField]: delta.newValue.slice(0, 500) },
        });
        result.itemsUpdated++;
      }

      // Create StoryEvent
      await prisma.storyEvent.create({
        data: {
          novelId,
          chapterOrder,
          chapterCommitId: commitId,
          eventType: resolveEventType(delta.field, delta.newValue),
          subject: delta.characterName,
          field: delta.field,
          oldValue: delta.oldValue ?? null,
          newValue: delta.newValue.slice(0, 2000),
          sourceChapter: chapterOrder,
          confidence: 0.9,
        },
      });
    }

    // Process entity deltas (appearances/departures)
    for (const entity of entityDeltas) {
      result.itemsProcessed++;
      const flags = entity.flags ?? {};
      const isNew = flags.is_new || flags.is_protagonist;
      const isDead = flags.is_dead || flags.status === 'dead';

      if (isNew) {
        await prisma.storyEvent.create({
          data: {
            novelId,
            chapterOrder,
            chapterCommitId: commitId,
            eventType: 'new_entity_appeared',
            subject: entity.name.slice(0, 200),
            newValue: entity.name.slice(0, 2000),
            sourceChapter: chapterOrder,
          },
        });
      }
      if (isDead) {
        await prisma.storyEvent.create({
          data: {
            novelId,
            chapterOrder,
            chapterCommitId: commitId,
            eventType: 'character_death',
            subject: entity.name.slice(0, 200),
            newValue: 'dead',
            sourceChapter: chapterOrder,
          },
        });
      }
    }

    // Process accepted events for StoryEvent records
    for (const evt of acceptedEvents) {
      result.itemsProcessed++;
      await prisma.storyEvent.create({
        data: {
          novelId,
          chapterOrder,
          chapterCommitId: commitId,
          eventType: evt.type ?? 'story_fact',
          subject: evt.subject?.slice(0, 200) ?? '',
          field: evt.field ?? null,
          oldValue: evt.oldValue ?? null,
          newValue: evt.newValue.slice(0, 2000),
          sourceChapter: chapterOrder,
        },
      });
    }

    // Update EntityLifecycle for death/revival
    for (const entity of entityDeltas) {
      const flags = entity.flags ?? {};
      if (flags.is_dead || flags.status === 'dead') {
        await updateEntityLifecycle(prisma, novelId, entity.name, 'dead', chapterOrder);
      }
    }

  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    logEventError("projection.stateWriter", { commitId, novelId, chapterId }, e);
  }

  return result;
}

/**
 * Resolve a state field change to a StoryEventType.
 */
function resolveEventType(field: string, newValue: string): string {
  if (field === 'currentStatus') {
    const lower = newValue.toLowerCase();
    if (lower.includes('dead') || lower.includes('die') || lower.includes('死亡')) return 'character_death';
    if (lower.includes('reviv') || lower.includes('复活')) return 'character_revival';
  }
  if (field === 'currentLocation') return 'location_change';
  if (field === 'currentGoal') return 'goal_change';
  return 'character_state_change';
}

/**
 * Fall back to LLM extraction when no extractionResult is available.
 */
async function extractStatesFromContent(
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content: string,
): Promise<Awaited<ReturnType<typeof aiInvoke>> & { updates: Array<{ characterName: string; currentStatus?: string; currentLocation?: string; currentGoal?: string }> } | null> {
  try {
    const prisma = getPrisma();
    const characters = await prisma.novelCharacter.findMany({
      where: { novelId },
      select: { id: true, name: true, role: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });

    if (characters.length === 0) return null;

    const charList = characters.map((c: { id: string; name: string; role: string; currentStatus: string | null; currentLocation: string | null; currentGoal: string | null }) => {
      const parts = [`${c.name} (${c.role})`];
      if (c.currentStatus) parts.push(`当前状态: ${c.currentStatus}`);
      if (c.currentLocation) parts.push(`位置: ${c.currentLocation}`);
      if (c.currentGoal) parts.push(`目标: ${c.currentGoal}`);
      return parts.join(' · ');
    }).join('\n');

    const result = await aiInvoke({
      assetId: 'novel.character.post-chapter',
      userPrompt: [
        `## 出场角色（当前状态）`,
        charList,
        '',
        `## 第${chapterOrder}章正文`,
        content.slice(0, REF_PROMPT_SLICE_LARGE),
      ].join('\n'),
      schema: CharacterPostChapterSchema,
      temperature: 0.3,
    });

    return result;
  } catch (e) {
    logEventError("projection.stateWriter.llmFallback", { chapterId }, e);
    return null;
  }
}

/**
 * Update EntityLifecycle status for a character.
 */
async function updateEntityLifecycle(
  prisma: ReturnType<typeof getPrisma>,
  novelId: string,
  characterName: string,
  newStatus: string,
  chapterOrder: number,
): Promise<void> {
  const character = await prisma.novelCharacter.findFirst({
    where: { novelId, name: characterName },
    select: { id: true },
  });
  if (!character) return;

  await prisma.entityLifecycle.upsert({
    where: { novelId_characterId: { novelId, characterId: character.id } },
    create: {
      novelId,
      characterId: character.id,
      status: newStatus,
      statusChangedAtChapter: chapterOrder,
    },
    update: {
      status: newStatus,
      statusChangedAtChapter: chapterOrder,
    },
  });
}
