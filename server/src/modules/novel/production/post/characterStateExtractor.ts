/**
 * Character State Extractor — shared LLM call for post-chapter character state extraction.
 *
 * Single source of truth for the prompt, schema, and LLM invocation that was previously
 * duplicated in characterStateUpdater.ts and stateProjectionWriter.ts.
 *
 * The DataAgent (dataAgent.ts) uses a DIFFERENT prompt/asset (`novel.chapter.extract`)
 * that does broader extraction (summary, scenes, payoffs, etc.) — it is NOT replaced here.
 */
import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { getPrisma } from "../../../../platform/db/client";
import { REF_PROMPT_SLICE_LARGE } from "../../../../platform/config/constants";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

// ─── Shared Zod Schema ─────────────────────────────────────

/** Grouped update — consumed by characterStateUpdater and stateProjectionWriter */
const CharacterPostChapterSchema = z.object({
  updates: z.array(z.object({
    characterName: z.string(),
    currentStatus: z.string().optional(),
    currentLocation: z.string().optional(),
    currentGoal: z.string().optional(),
    availability: z.string().optional(),
    relationshipChanges: z.array(z.object({
      targetName: z.string(),
      changeDescription: z.string(),
    })).optional(),
  })).max(20).default([]),
});

// ─── Result Types ──────────────────────────────────────────

export interface CharacterStateUpdate {
  characterName: string;
  currentStatus?: string;
  currentLocation?: string;
  currentGoal?: string;
  availability?: string;
  relationshipChanges?: Array<{ targetName: string; changeDescription: string }>;
}

export interface ExtractedCharacterStates {
  /** Grouped by character — what characterStateUpdater expects */
  updates: CharacterStateUpdate[];
}

// ─── Shared Extractor ──────────────────────────────────────

/**
 * Extract character state changes from chapter content via a single LLM call.
 *
 * Returns grouped updates (by character) including optional relationship changes.
 * Callers can flatten this into delta format if needed.
 *
 * @returns Normalized result, or null on failure
 */
export async function extractCharacterStates(
  novelId: string,
  chapterOrder: number,
  content: string,
): Promise<ExtractedCharacterStates | null> {
  try {
    const characters = await getPrisma().novelCharacter.findMany({
      where: { novelId },
      select: { id: true, name: true, role: true, currentStatus: true, currentLocation: true, currentGoal: true },
    });

    if (characters.length === 0) return { updates: [] };

    const charList = characters
      .map(c => {
        const parts = [`${c.name} (${c.role})`];
        if (c.currentStatus) parts.push(`当前状态: ${c.currentStatus}`);
        if (c.currentLocation) parts.push(`位置: ${c.currentLocation}`);
        if (c.currentGoal) parts.push(`目标: ${c.currentGoal}`);
        return parts.join(" · ");
      })
      .join("\n");

    const result = await aiInvoke({
      assetId: "novel.character.post-chapter",
      userPrompt: [
        `## 出场角色（当前状态）`,
        charList,
        "",
        `## 第${chapterOrder}章正文`,
        content.slice(0, REF_PROMPT_SLICE_LARGE),
      ].join("\n"),
      schema: CharacterPostChapterSchema,
      temperature: 0.3,
    });

    return { updates: result.updates };
  } catch (e) {
    logEventError("characterStateExtractor", { novelId, chapterOrder }, e);
    return null;
  }
}
