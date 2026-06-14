/**
 * Shared text utilities for chapter content processing.
 * Centralizes paragraph splitting logic used by revision, repair, and diagnosis services.
 */

/** Split HTML chapter content into plain-text paragraphs. */
export function splitParagraphs(content: string): string[] {
  return content
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
}
