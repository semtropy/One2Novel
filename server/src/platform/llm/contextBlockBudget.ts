import type { PromptContextBlock } from "./promptTypes";

export function estimateTextTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function createContextBlock(input: {
  id: string;
  group: string;
  priority: number;
  required?: boolean;
  content: string;
  conflictGroup?: string;
  freshness?: number;
}): PromptContextBlock {
  return {
    id: input.id,
    group: input.group,
    priority: input.priority,
    required: input.required ?? false,
    content: input.content.trim(),
    estimatedTokens: estimateTextTokens(input.content),
    conflictGroup: input.conflictGroup,
    freshness: input.freshness,
  };
}
