/**
 * Character State Updater — unified post-chapter character tracking.
 *
 * Extracts character state changes AND relationship changes from each newly completed
 * chapter in a single AI call (replaces the old separate state-update + dynamics.post).
 * Fire-and-forget — failures are logged but don't block the chapter write.
 */
import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

const CharacterPostChapterSchema = z.object({
  updates: z.array(z.object({
    characterName: z.string(),
    // State changes
    currentStatus: z.string().optional(),
    currentLocation: z.string().optional(),
    currentGoal: z.string().optional(),
    availability: z.string().optional(),
    // Relationship changes (merged from old character.dynamics.post)
    relationshipChanges: z.array(z.object({
      targetName: z.string(),
      changeDescription: z.string(),
    })).optional(),
  })).max(20).default([]),
});

/**
 * Extract character state + relationship changes from a completed chapter and persist them.
 * Single AI call handles what was previously two separate calls.
 * Fire-and-forget — never throws, always logs errors.
 */
export async function updateCharacterStatesAfterChapter(
  novelId: string,
  chapterContent: string,
  chapterOrder: number,
): Promise<void> {
  try {
    const prisma = getPrisma();
    const characters = await prisma.novelCharacter.findMany({
      where: { novelId },
      select: { id: true, name: true, role: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });

    if (characters.length === 0) return;

    const charList = characters
      .map(c => {
        const parts = [`${c.name} (${c.role})`];
        if (c.currentStatus) parts.push(`当前状态: ${c.currentStatus}`);
        if (c.currentLocation) parts.push(`位置: ${c.currentLocation}`);
        if (c.currentGoal) parts.push(`目标: ${c.currentGoal}`);
        return parts.join(" · ");
      })
      .join("\n");

    const userPrompt = [
      `## 出场角色（当前状态）`,
      charList,
      "",
      `## 第${chapterOrder}章正文`,
      chapterContent.slice(0, 6000),
    ].join("\n");

    const result = await aiInvoke({
      assetId: "novel.character.post-chapter",
      userPrompt,
      schema: CharacterPostChapterSchema,
      temperature: 0.3,
    });

    // Persist state updates
    let updated = 0;
    for (const update of result.updates) {
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
            }).catch(() => {});
          }
        }
      }
    }

    if (updated > 0) {
      console.log(`[CharacterState] Updated ${updated} characters after chapter ${chapterOrder}`);
    }
  } catch (e) {
    logEventError("characterStateUpdate", { novelId, chapterOrder }, e);
  }
}
