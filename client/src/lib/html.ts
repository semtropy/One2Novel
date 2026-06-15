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

/** Escape HTML special characters to prevent XSS when rendering user/AI text */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
