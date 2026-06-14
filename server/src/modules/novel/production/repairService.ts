import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";

const RepairSchema = z.object({ repairedText: z.string(), changesSummary: z.string() });

export async function patchRepair(content: string, issues: string): Promise<string> {
  const r = await aiInvoke({
    assetId: "novel.chapter.repair.patch",
    userPrompt: `审查意见：\n${issues}\n\n原文：\n${content.slice(0, 8000)}`,
    schema: RepairSchema, temperature: 0.5,
  });
  return r.repairedText;
}

export async function heavyRepair(content: string, issues: string): Promise<string> {
  const r = await aiInvoke({
    assetId: "novel.chapter.repair.heavy",
    userPrompt: `审查意见：\n${issues}\n\n原文：\n${content.slice(0, 8000)}`,
    schema: RepairSchema, temperature: 0.7,
  });
  return r.repairedText;
}

export async function repairChapter(content: string, issues: string): Promise<string> {
  return patchRepair(content, issues);
}

/**
 * Format issues for the repair prompt.
 * Accepts either a JSON array (from HTTP route) or a formatted text string (from Director),
 * and produces a consistent human-readable format for the LLM.
 */
export function formatIssuesForRepair(
  issues: Array<{ type?: string; description?: string; fixSuggestion?: string }> | string,
): string {
  if (typeof issues === "string") {
    // Try parsing as JSON array first (HTTP route passes JSON.stringify'd array)
    try {
      const arr = JSON.parse(issues);
      if (Array.isArray(arr)) {
        return arr.map((i: { type?: string; description?: string; fixSuggestion?: string }) =>
          `${i.type ?? "issue"}: ${i.description ?? ""}${i.fixSuggestion ? `（建议：${i.fixSuggestion}）` : ""}`
        ).join("\n");
      }
    } catch { /* not JSON — treat as pre-formatted text */ }
    return issues;
  }
  // Array input (Director path)
  return issues.map(i =>
    `${i.type ?? "issue"}: ${i.description ?? ""}${i.fixSuggestion ? `（建议：${i.fixSuggestion}）` : ""}`
  ).join("\n");
}
