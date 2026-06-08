/**
 * Format Cleanup — fixes common formatting issues in AI-generated chapters.
 * Non-destructive scan first, then batch cleanup.
 */

import { getPrisma } from "../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface FormattingIssue {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  count: number;
}

export interface CleanupResult {
  chapterId: string;
  issuesFixed: string[];
  charsBefore: number;
  charsAfter: number;
}

// ─── Detection ─────────────────────────────────────────

export function detectFormattingIssues(content: string): FormattingIssue[] {
  const issues: FormattingIssue[] = [];
  const stripped = content.replace(/<[^>]*>/g, "");

  // 1. HTML artifacts
  const htmlMatches = content.match(/<[^>]*>/g);
  if (htmlMatches && htmlMatches.length > 0) {
    const stray = htmlMatches.filter(t => !/^<\/?(p|br|div|span|h[1-6]|em|strong|ul|ol|li|blockquote)/.test(t));
    if (stray.length > 0) {
      issues.push({ type: "HTML残留", severity: "medium", description: `发现${stray.length}处非标准HTML标签`, count: stray.length });
    }
  }

  // 2. Double/triple line breaks
  const multiBreaks = stripped.match(/\n{3,}/g);
  if (multiBreaks && multiBreaks.length > 0) {
    issues.push({ type: "多余空行", severity: "low", description: `发现${multiBreaks.length}处连续3+换行`, count: multiBreaks.length });
  }

  // 3. Trailing whitespace
  const trailingWs = content.match(/[ \t]+$/gm);
  if (trailingWs && trailingWs.length > 0) {
    issues.push({ type: "行尾空白", severity: "low", description: `发现${trailingWs.length}行有行尾空白`, count: trailingWs.length });
  }

  // 4. AI markdown artifacts
  const mdArtifacts = content.match(/\*\*[^*]+\*\*/g);
  if (mdArtifacts && mdArtifacts.length > 2) {
    issues.push({ type: "AI加粗残留", severity: "medium", description: `发现${mdArtifacts.length}处markdown加粗残留`, count: mdArtifacts.length });
  }

  // 5. Mixed full-width / half-width punctuation in same paragraph
  const paragraphs = stripped.split(/\n\n+/);
  let mixedPunct = 0;
  for (const p of paragraphs) {
    const hasFullWidth = /[，。；：！？]/.test(p);
    const hasHalfWidth = /[,.;:!?]/.test(p);
    if (hasFullWidth && hasHalfWidth) mixedPunct++;
  }
  if (mixedPunct > 0) {
    issues.push({ type: "标点混用", severity: "low", description: `发现${mixedPunct}个段落中英文标点混用`, count: mixedPunct });
  }

  // 6. Repeated paragraph (exact duplicate)
  const seen = new Set<string>();
  let duplicates = 0;
  for (const p of paragraphs) {
    const normalized = p.trim();
    if (normalized.length < 10) continue;
    if (seen.has(normalized)) duplicates++;
    seen.add(normalized);
  }
  if (duplicates > 0) {
    issues.push({ type: "段落重复", severity: "high", description: `发现${duplicates}个重复段落`, count: duplicates });
  }

  return issues;
}

// ─── Cleanup ───────────────────────────────────────────

export function cleanupContent(content: string): string {
  let result = content;

  // 1. Remove non-standard HTML tags but keep basic semantic tags
  result = result.replace(/<(?!\/?(p|br\s*\/?|div|span|h[1-6]|em|strong|ul|ol|li|blockquote|a\s[^>]*))[^>]*>/gi, "");
  result = result.replace(/<\/?(?!p|br|div|span|h[1-6]|em|strong|ul|ol|li|blockquote|a)[a-z][a-z0-9]*[^>]*>/gi, "");

  // 2. Normalize line breaks: max 2 consecutive
  result = result.replace(/\n{3,}/g, "\n\n");

  // 3. Remove trailing whitespace
  result = result.replace(/[ \t]+$/gm, "");

  // 4. Normalize blank lines around paragraphs
  result = result.replace(/\n{2,}\n/g, "\n\n");

  // 5. Convert markdown bold to plain text (remove ** markers)
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");

  // 6. Normalize half-width punctuation to full-width in Chinese context
  result = result.replace(/([一-鿿]),/g, "$1，");
  result = result.replace(/([一-鿿])\./g, "$1。");
  result = result.replace(/([一-鿿]);/g, "$1；");
  result = result.replace(/([一-鿿]):/g, "$1：");
  result = result.replace(/([一-鿿])!/g, "$1！");
  result = result.replace(/([一-鿿])\?/g, "$1？");

  // 7. Trim leading/trailing whitespace
  result = result.trim();

  return result;
}

// ─── Persistence ───────────────────────────────────────

export async function cleanupChapter(chapterId: string): Promise<CleanupResult> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) throw new Error("Chapter has no content");

  const charsBefore = chapter.content.length;
  const cleaned = cleanupContent(chapter.content);
  const issuesBefore = detectFormattingIssues(chapter.content);
  const issuesAfter = detectFormattingIssues(cleaned);

  const issuesFixed = issuesBefore
    .filter(ib => !issuesAfter.some(ia => ia.type === ib.type && ia.count >= ib.count))
    .map(ib => ib.type);

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { content: cleaned },
  });

  return {
    chapterId,
    issuesFixed,
    charsBefore,
    charsAfter: cleaned.length,
  };
}

export async function cleanupAllChapters(novelId: string): Promise<CleanupResult[]> {
  const prisma = getPrisma();
  const chapters = await prisma.chapter.findMany({
    where: { novelId, content: { not: null } },
    select: { id: true },
  });

  const results: CleanupResult[] = [];
  for (const ch of chapters) {
    try {
      results.push(await cleanupChapter(ch.id));
    } catch {
      // Skip chapters with errors
    }
  }
  return results;
}
