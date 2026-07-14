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
import { extractCharacterStates } from "../../post/characterStateExtractor";

export interface StateProjectionResult {
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  success: boolean;
  error?: string;
}

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

    // If no deltas from extraction, fall back to shared extractor
    if (stateDeltas.length === 0 && content) {
      const extracted = await extractCharacterStates(novelId, chapterOrder, content);
      if (extracted) {
        for (const u of extracted.updates) {
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
