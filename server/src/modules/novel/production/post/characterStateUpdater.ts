/**
 * Character State Updater — unified post-chapter character tracking.
 *
 * Extracts character state changes AND relationship changes from each newly completed
 * chapter in a single AI call (replaces the old separate state-update + dynamics.post).
 * Fire-and-forget — failures are logged but don't block the chapter write.
 *
 * Uses the shared characterStateExtractor to avoid duplicate LLM calls.
 */
import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { extractCharacterStates } from "./characterStateExtractor";

/**
 * Extract character state + relationship changes from a completed chapter and persist them.
 * Single AI call handles what was previously two separate calls.
 * Fire-and-forget — never throws, always logs errors.
 *
 * Returns updates for downstream consumers (entityLifecycle, etc.).
 */
export async function updateCharacterStatesAfterChapter(
  novelId: string,
  chapterContent: string,
  chapterOrder: number,
): Promise<{ updates: Array<{
  characterId: string;
  characterName: string;
  oldStatus: string | null;
  newStatus: string | null;
  currentLocation: string | null;
  currentGoal: string | null;
}> } | null> {
  try {
    const prisma = getPrisma();
    const characters = await prisma.novelCharacter.findMany({
      where: { novelId },
      select: { id: true, name: true, role: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });

    if (characters.length === 0) return null;

    // Snapshot old states for lifecycle tracking
    const oldStates = new Map(characters.map(c => [c.name, {
      characterId: c.id,
      oldStatus: c.currentStatus,
      oldLocation: c.currentLocation,
      oldGoal: c.currentGoal,
    }]));

    const extracted = await extractCharacterStates(novelId, chapterOrder, chapterContent);
    if (!extracted) return null;

    // Persist state updates
    let updated = 0;
    for (const update of extracted.updates) {
      const character = characters.find(c => c.name === update.characterName);
      if (!character) continue;

      // Update character fields
      const data: Record<string, string> = {};
      if (update.currentStatus) data.currentStatus = update.currentStatus;
      if (update.currentLocation) data.currentLocation = update.currentLocation;
      if (update.currentGoal) data.currentGoal = update.currentGoal;
      if (update.availability) data.availability = update.availability;

      if (Object.keys(data).length > 0) {
        await prisma.novelCharacter.update({ where: { id: character.id }, data });
        updated++;
      }

      // Update relationships
      if (update.relationshipChanges) {
        for (const rel of update.relationshipChanges) {
          const target = characters.find(c => c.name === rel.targetName);
          if (!target) continue;
          const existing = await prisma.novelCharacterRelation.findFirst({
            where: { novelId, sourceCharacterId: character.id, targetCharacterId: target.id },
          });
          if (existing) {
            await prisma.novelCharacterRelation.update({
              where: { id: existing.id },
              data: { summary: rel.changeDescription },
            }).catch(e => logEventError("characterState.updateRelation", { characterId: character.id, targetId: target.id }, e)); // intentional: fire-and-forget, failure tolerated
          }
        }
      }
    }

    if (updated > 0) {
      console.log(`[CharacterState] Updated ${updated} characters after chapter ${chapterOrder}`);
    }

    // Collect updates for downstream consumers (entityLifecycle)
    const updates = Array.from(oldStates.entries())
      .filter(([name]) => extracted.updates.some(u => u.characterName === name))
      .map(([name, old]) => {
        const newUpdate = extracted.updates.find(u => u.characterName === name);
        return {
          characterId: old.characterId,
          characterName: name,
          oldStatus: old.oldStatus,
          newStatus: newUpdate?.currentStatus ?? null,
          currentLocation: newUpdate?.currentLocation ?? old.oldLocation,
          currentGoal: newUpdate?.currentGoal ?? old.oldGoal,
        };
      });

    return { updates };
  } catch (e) {
    logEventError("characterStateUpdate", { novelId, chapterOrder }, e);
    return null;
  }
}
