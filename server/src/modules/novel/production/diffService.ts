/**
 * Diff Service — Chinese-aware text diff for revision preview.
 * ADAPTED from OP chapterEditorDiff.ts (84 lines).
 */

export interface DiffChunk {
  type: "equal" | "insert" | "delete";
  text: string;
}

// ─── Tokenization ──────────────────────────────────────

/** Tokenize Chinese text: characters, words, punctuation as individual tokens */
function tokenize(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  // Split: CJK chars individually, ASCII words together, whitespace, punctuation
  const parts = normalized.match(/[一-鿿]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_一-鿿]/g) ?? [];
  return parts;
}

// ─── LCS Diff ──────────────────────────────────────────

const MAX_TOKENS = 3000; // ~3000 Chinese chars — prevent OOM on full-chapter inputs

/** Compute LCS-based diff between original and rewritten text */
export function computeDiff(original: string, rewritten: string): DiffChunk[] {
  const source = tokenize(original);
  const target = tokenize(rewritten);
  if (source.length > MAX_TOKENS || target.length > MAX_TOKENS) {
    // Fallback: show full replacement for very long inputs
    return [{ type: "delete", text: original.slice(0, 500) + (original.length > 500 ? "..." : "") }, { type: "insert", text: rewritten.slice(0, 500) + (rewritten.length > 500 ? "..." : "") }];
  }
  const sl = source.length;
  const tl = target.length;

  // LCS table: DP from bottom-right
  const lcs: number[][] = Array.from({ length: sl + 1 }, () => new Array<number>(tl + 1).fill(0));
  for (let i = sl - 1; i >= 0; i--) {
    for (let j = tl - 1; j >= 0; j--) {
      if (source[i] === target[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  // Backtrack to build diff chunks
  const chunks: DiffChunk[] = [];
  let si = 0, ti = 0;

  function push(type: DiffChunk["type"], text: string): void {
    if (!text) return;
    const last = chunks[chunks.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      chunks.push({ type, text });
    }
  }

  while (si < sl && ti < tl) {
    if (source[si] === target[ti]) {
      push("equal", source[si]);
      si++; ti++;
    } else if (lcs[si + 1][ti] >= lcs[si][ti + 1]) {
      push("delete", source[si]);
      si++;
    } else {
      push("insert", target[ti]);
      ti++;
    }
  }
  while (si < sl) push("delete", source[si++]);
  while (ti < tl) push("insert", target[ti++]);

  return chunks;
}

// ─── HTML Formatting ───────────────────────────────────

/** Format diff chunks as HTML with <ins>/<del> tags */
export function formatDiffHtml(original: string, rewritten: string): string {
  const chunks = computeDiff(original, rewritten);
  return chunks.map(c => {
    switch (c.type) {
      case "equal": return c.text;
      case "insert": return `<ins class="diff-add">${c.text}</ins>`;
      case "delete": return `<del class="diff-del">${c.text}</del>`;
    }
  }).join("");
}

/** Simple summary: what was added and removed */
export function diffSummary(original: string, rewritten: string): { added: number; removed: number } {
  const origLen = original.replace(/\s/g, "").length;
  const rewrittenLen = rewritten.replace(/\s/g, "").length;
  return {
    added: Math.max(0, rewrittenLen - origLen),
    removed: Math.max(0, origLen - rewrittenLen),
  };
}
