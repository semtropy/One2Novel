import type { PromptContextBlock } from "./promptTypes";

/**
 * Render selected context blocks into a single user-prompt string.
 * Each block may include an instructionHeader that tells the LLM HOW to use the data.
 * Blocks without instructionHeader are rendered as-is (backward compatible).
 */
export function renderSelectedContextBlocks(blocks: PromptContextBlock[], emptyLabel = "none"): string {
  if (blocks.length === 0) {
    return emptyLabel;
  }
  return blocks
    .map((block) => {
      const body = block.content.trim();
      if (!body) return "";
      if (block.instructionHeader) {
        return `${block.instructionHeader}\n${body}`;
      }
      return body;
    })
    .filter(Boolean)
    .join("\n\n");
}
