import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";

const RepairSchema = z.object({ repairedText: z.string(), changesSummary: z.string() });
const MAX_CONTENT_CHARS = 8000;

async function repairWith(assetId: string, temperature: number, content: string, issues: string): Promise<string> {
  const r = await aiInvoke({
    assetId,
    userPrompt: `审查意见：\n${issues}\n\n原文：\n${content.slice(0, MAX_CONTENT_CHARS)}`,
    schema: RepairSchema, temperature,
  });
  return r.repairedText;
}

export function patchRepair(content: string, issues: string): Promise<string> {
  return repairWith("novel.chapter.repair.patch", 0.5, content, issues);
}

export function heavyRepair(content: string, issues: string): Promise<string> {
  return repairWith("novel.chapter.repair.heavy", 0.7, content, issues);
}

export function repairChapter(content: string, issues: string): Promise<string> {
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
