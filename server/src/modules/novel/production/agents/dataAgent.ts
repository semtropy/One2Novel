/**
 * DataAgent — extracts structured facts from completed chapter text.
 *
 * This is a new LLM-powered agent that produces the extractionResult
 * stored in ChapterCommit. Its output feeds the projection writers
 * (state, memory, vector, etc.) with pre-extracted structured data,
 * eliminating the need for separate LLM calls in characterStateUpdater
 * and memoryWriter.
 *
 * Net LLM cost: adds 1 call but eliminates 2 existing calls.
 *
 * Output schema mirrors wNW's data-agent extraction_result.json:
 * - state_deltas: character state changes
 * - entity_deltas: new/deceased/modified characters
 * - accepted_events: StoryEvent records
 * - summary_text: chapter summary
 * - scenes: scene breakdown
 * - fulfillment_result: planned vs covered narrative nodes
 */

import { aiInvoke } from "../../../../platform/llm/aiService";
import { assembleChapterContext } from "../context/contextAssembler";
import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { z } from "zod";
import type { AgentRun } from "./types";

// ─── Zod Schema ────────────────────────────────────────────

const StateDeltaSchema = z.object({
  characterName: z.string(),
  field: z.enum(["currentStatus", "currentLocation", "currentGoal", "availability"]),
  oldValue: z.string().nullable(),
  newValue: z.string(),
});

const EntityDeltaSchema = z.object({
  name: z.string(),
  flags: z.record(z.string(), z.boolean()).optional(),
});

const MemoryFactsSchema = z.object({
  timeline_events: z.array(z.string()).optional(),
  world_rules: z.array(z.string()).optional(),
  open_loops: z.array(z.string()).optional(),
  reader_promises: z.array(z.string()).optional(),
}).optional();

const AcceptedEventSchema = z.object({
  type: z.string(),
  subject: z.string(),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string(),
  memory_facts: MemoryFactsSchema,
});

const SceneSchema = z.object({
  order: z.number(),
  title: z.string(),
  summary: z.string(),
  pov: z.string(),
  participants: z.array(z.string()),
});

const FulfillmentResultSchema = z.object({
  planned_nodes: z.array(z.string()),
  covered_nodes: z.array(z.string()),
  missed_nodes: z.array(z.string()),
});

const DataAgentSchema = z.object({
  state_deltas: z.array(StateDeltaSchema).default([]),
  entity_deltas: z.array(EntityDeltaSchema).default([]),
  accepted_events: z.array(AcceptedEventSchema).default([]),
  summary_text: z.string(),
  scenes: z.array(SceneSchema).optional(),
  fulfillment_result: FulfillmentResultSchema.default({
    planned_nodes: [],
    covered_nodes: [],
    missed_nodes: [],
  }),
});

export interface DataAgentOptions {
  maxRetries?: number;
}

/**
 * Run the DataAgent for a completed chapter.
 *
 * Extracts structured facts from chapter content and returns them
 * as a standardized extraction result. On failure, returns a minimal
 * fallback so projections can still run.
 */
export async function runDataAgent(
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content: string,
  opts: DataAgentOptions = {},
): Promise<AgentRun<Record<string, unknown>>> {
  const start = Date.now();
  const maxRetries = opts.maxRetries ?? 1;
  const result: AgentRun<Record<string, unknown>> = {
    agentId: "data",
    status: "completed",
  };

  try {
    // Gather context for the extraction call
    const flatCtx = await assembleChapterContext(novelId, chapterId);
    const characters = await fetchCharactersForContext(novelId);

    const charList = characters.map(c =>
      `${c.name} (${c.role}) — 状态: ${c.currentStatus ?? "未知"}, 位置: ${c.currentLocation ?? "未知"}, 目标: ${c.currentGoal ?? "未知"}`
    ).join("\n");

    const userPrompt = [
      `## 章节事实提取`,
      `章节：第${chapterOrder}章`,
      ``,
      `## 出场角色（当前状态）`,
      charList,
      ``,
      `## 本章正文`,
      content.slice(0, 6000),
      ``,
      `## 提取要求`,
      `从本章中提取所有结构化事实。包括：`,
      `1. 角色状态变化（state_deltas）`,
      `2. 实体新增/死亡/消亡（entity_deltas）`,
      `3. 已确认的故事事件（accepted_events）`,
      `4. 章节摘要（summary_text，100-150字）`,
      `5. 场景拆解（scenes，如有明显场景转换）`,
      `6. 计划节点兑现情况（fulfillment_result）`,
      ``,
      `只输出JSON，不要解释。`,
    ].join("\n");

    const extraction = await aiInvoke({
      assetId: "novel.chapter.extract",
      userPrompt,
      schema: DataAgentSchema,
      temperature: 0.3,
    });

    result.output = extraction;
    result.durationMs = Date.now() - start;
  } catch (e) {
    result.status = "partial";
    result.errors = [e instanceof Error ? e.message : String(e)];
    result.autoHandled = true;
    result.durationMs = Date.now() - start;

    // Minimal fallback
    result.fallback = {
      state_deltas: [],
      entity_deltas: [],
      accepted_events: [],
      summary_text: content.slice(0, 500),
      scenes: [],
      fulfillment_result: { planned_nodes: [], covered_nodes: [], missed_nodes: [] },
    };
  }

  return result;
}

/**
 * Fetch character list for context injection.
 */
async function fetchCharactersForContext(novelId: string) {
  const prisma = getPrisma();
  return prisma.novelCharacter.findMany({
    where: { novelId },
    select: { id: true, name: true, role: true, currentStatus: true, currentLocation: true, currentGoal: true },
  });
}
