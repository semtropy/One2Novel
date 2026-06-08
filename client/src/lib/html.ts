/**
 * Extract paragraphs from HTML content, matching the server-side
 * paragraph splitting logic used by diagnoseWorkspace.
 */
export function extractParagraphs(html: string): string[] {
  if (!html) return [];
  return html
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
}
