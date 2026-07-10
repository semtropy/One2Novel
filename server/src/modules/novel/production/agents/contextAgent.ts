/**
 * ContextAgent — wraps assembleChapterBlocks + assembleChapterContext
 * to produce a structured WritingTaskBrief (写作任务书).
 *
 * Inspired by wNW's context-agent which produces a five-paragraph task brief
 * before chapter drafting. The brief guides the writer with story goal,
 * character states, plot nodes, style guidance, and ending direction.
 *
 * Two modes:
 * 1. Brief mode (new): LLM call that summarizes context blocks into WritingTaskBrief
 * 2. Fallback mode: Returns minimal brief from flat context if LLM call fails
 *
 * Reuses existing contextAssembler functions verbatim — no rewriting.
 */

import { assembleChapterBlocks, assembleChapterContext } from "../context/contextAssembler";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { z } from "zod";
import type { AgentRun, WritingTaskBrief } from "./types";

const BriefSchema = z.object({
  storyGoal: z.string(),
  characterStates: z.array(z.object({
    name: z.string(),
    status: z.string(),
    location: z.string(),
    goal: z.string(),
    motivation: z.string(),
  })),
  plotNodes: z.array(z.object({
    node: z.string(),
    constraint: z.string(),
    priority: z.enum(["required", "preferred", "nice_to_have"]),
  })),
  styleGuidance: z.string(),
  endingDirection: z.string(),
});

export interface ContextAgentOptions {
  /** When true, produce WritingTaskBrief via LLM. When false, return raw blocks. */
  produceBrief?: boolean;
}

/**
 * Run the ContextAgent for a chapter.
 *
 * Returns AgentRun<WritingTaskBrief> with lifecycle tracking.
 * On failure, returns a minimal fallback brief so the pipeline can continue.
 */
export async function runContextAgent(
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  opts: ContextAgentOptions = {},
): Promise<AgentRun<WritingTaskBrief>> {
  const start = Date.now();
  const result: AgentRun<WritingTaskBrief> = {
    agentId: "context",
    status: "completed",
  };

  try {
    const produceBrief = opts.produceBrief ?? false;

    // Step 1: Assemble context (reuse existing function)
    const flatCtx = await assembleChapterContext(novelId, chapterId);
    const blocks = await assembleChapterBlocks(novelId, chapterId);

    if (!produceBrief) {
      // Fallback: no brief mode, return minimal brief from flat context
      result.output = {
        storyGoal: flatCtx.chapterExpectation ?? "推进主线",
        characterStates: [],
        plotNodes: [],
        styleGuidance: flatCtx.styleContext ?? "",
        endingDirection: flatCtx.outline ?? "",
        contextBlocks: blocks,
      };
      result.durationMs = Date.now() - start;
      return result;
    }

    // Step 2: LLM call to produce structured brief from context blocks
    const blocksText = blocks.map(b => `[${b.group}] ${b.content}`).join("\n\n");
    const userPrompt = [
      `## 写作任务书生成`,
      `章节：第${chapterOrder}章`,
      ``,
      `以下是从小说项目上下文中组装的全部上下文块：`,
      blocksText,
      ``,
      `请将这些上下文块浓缩为一份结构化的「写作任务书」，包含五个部分：`,
      `1. 故事目标（本章要达成的叙事目的）`,
      `2. 角色状态与动机（出场角色的当前状态和本章推断出的动机）`,
      `3. 情节节点与约束（必须完成的情节节点和不可违背的约束）`,
      `4. 风格指导（来自风格合约和对标书的写作风格要求）`,
      `5. 结尾方向（本章应该引导向的方向）`,
      ``,
      `只输出JSON，不要解释。`,
    ].join("\n");

    const brief = await aiInvoke({
      assetId: "novel.chapter.brief",
      userPrompt,
      schema: BriefSchema,
      temperature: 0.3,
    });

    // Combine LLM output with raw blocks for backward compat
    result.output = { ...brief, contextBlocks: blocks };
    result.durationMs = Date.now() - start;
  } catch (e) {
    result.status = "partial";
    result.errors = [e instanceof Error ? e.message : String(e)];
    result.autoHandled = true;
    result.durationMs = Date.now() - start;

    // Fallback: return minimal brief from flat context
    try {
      const flatCtx = await assembleChapterContext(novelId, chapterId);
      result.fallback = {
        storyGoal: flatCtx.chapterExpectation ?? "推进主线",
        characterStates: [],
        plotNodes: [],
        styleGuidance: flatCtx.styleContext ?? "",
        endingDirection: flatCtx.outline ?? "",
        contextBlocks: [],
      };
    } catch {
      // Complete fallback
      result.fallback = {
        storyGoal: "推进主线",
        characterStates: [],
        plotNodes: [],
        styleGuidance: "",
        endingDirection: "",
        contextBlocks: [],
      };
    }
  }

  return result;
}
