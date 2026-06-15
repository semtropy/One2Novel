/**
 * Repair Context Assembler — builds system+repair prompt for chapter repair.
 *
 * Extracted from contextAssembler.ts to reduce module size and clarify
 * this single-concern utility.
 */

import type { ChapterContext } from "../context/contextBlockBuilders";

export function assembleRepairContext(
  ctx: ChapterContext,
  content: string,
  issues: string,
): { systemContext: string; repairPrompt: string } {
  // System context: what MUST be preserved
  const systemContext = [
    ctx.characters ? `【出场角色（不可违背）】\n${ctx.characters}` : "",
    ctx.payoffContext || "",
    ctx.outline ? `【本章必须完成】\n${ctx.outline}` : "",
  ].filter(Boolean).join("\n\n");

  // Repair prompt: issues + content for the LLM
  const repairPrompt = [
    `## 需要修复的问题\n${issues}`,
    "",
    "## 原文",
    content.slice(0, 8000),
  ].join("\n");

  return { systemContext, repairPrompt };
}
