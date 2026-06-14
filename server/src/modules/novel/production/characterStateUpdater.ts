/**
 * Character State Updater — auto-update NovelCharacter states after chapter completion.
 *
 * This fixes a major consistency gap: previously, character states (currentStatus,
 * currentLocation, currentGoal) were only written once during character confirmation
 * and never updated again. After 30 chapters, the AI was still using Chapter 1 states.
 *
 * This module extracts state changes from each newly completed chapter and persists
 * them to the NovelCharacter table. It is fire-and-forget — failures are logged but
 * don't block the chapter write.
 */

import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { logEventError } from "../../../platform/logging/eventErrorLog";

const CharacterStateUpdateSchema = z.object({
  updates: z.array(z.object({
    name: z.string(),
    currentStatus: z.string().optional(),
    currentLocation: z.string().optional(),
    currentGoal: z.string().optional(),
    availability: z.string().optional(),
  })).max(20).default([]),
});

export interface CharacterStateUpdate {
  name: string;
  currentStatus?: string;
  currentLocation?: string;
  currentGoal?: string;
  availability?: string;
}

/**
 * Extract character state changes from a completed chapter and persist them.
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
      select: { id: true, name: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });

    if (characters.length === 0) return;

    const charList = characters
      .map(c => {
        const parts = [`${c.name}`];
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
      assetId: "novel.character.state-update",
      userPrompt,
      schema: CharacterStateUpdateSchema,
      temperature: 0.3,
    });

    // Persist updates
    let updated = 0;
    for (const update of result.updates) {
      const character = characters.find(c => c.name === update.name);
      if (character) {
        const data: Record<string, string> = {};
        if (update.currentStatus) data.currentStatus = update.currentStatus;
        if (update.currentLocation) data.currentLocation = update.currentLocation;
        if (update.currentGoal) data.currentGoal = update.currentGoal;
        if (update.availability) data.availability = update.availability;

        if (Object.keys(data).length > 0) {
          await prisma.novelCharacter.update({
            where: { id: character.id },
            data,
          });
          updated++;
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
