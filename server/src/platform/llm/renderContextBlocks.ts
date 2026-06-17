import type { PromptContextBlock } from "./promptTypes";

/** Join selected context blocks into a single user-prompt string */
export function renderSelectedContextBlocks(blocks: PromptContextBlock[], emptyLabel = "none"): string {
  if (blocks.length === 0) {
    return emptyLabel;
  }
  return blocks
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}
