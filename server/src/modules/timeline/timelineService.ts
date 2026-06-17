/**
 * Timeline Service — unified timeline extraction, conflict detection, and context assembly.
 *
 * Single entry point: afterChapterSave() — called by ALL chapter-write paths.
 * All results are persisted: TimelineItem rows + AuditReport rows.
 *
 * ADAPTED from OP timelineService.ts + timelineConflictService.ts + timelineExtractor.prompts.ts.
 */

import { z } from "zod";
import { getPrisma } from "../../platform/db/client";
import { aiInvoke } from "../../platform/llm/aiService";
import { logEventError } from "../../platform/logging/eventErrorLog";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface TimelineConflict {
  type: "sequence" | "logic" | "deadline" | "duplicate";
  description: string;
  itemA: { title: string; sortOrder: number };
  itemB: { title: string; sortOrder: number };
  severity: "low" | "medium" | "high";
}

export interface AfterChapterSaveResult {
  timelineItemsCreated: number;
  conflicts: TimelineConflict[];
  hasNewConflicts: boolean;
}

// ═══════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════

const ExtractionSchema = z.object({
  events: z.array(z.object({
    title: z.string(),
    description: z.string(),
    sortOrder: z.number().int(),
    category: z.enum(["event", "deadline", "milestone", "constraint"]),
  })).max(10).default([]),
});

const ConflictSchema = z.object({
  conflicts: z.array(z.object({
    type: z.enum(["sequence", "logic", "deadline", "duplicate"]),
    description: z.string(),
    itemA: z.object({ title: z.string(), sortOrder: z.number() }),
    itemB: z.object({ title: z.string(), sortOrder: z.number() }),
    severity: z.enum(["low", "medium", "high"]),
  })).default([]),
});

// ═══════════════════════════════════════════════════════════
// Extraction
// ═══════════════════════════════════════════════════════════

function buildExtractionUserPrompt(
  existingItemsText: string,
  chapterContent: string,
  chapterOrder: number,
): string {
  const parts: string[] = [];
  if (existingItemsText) {
    parts.push(`【已有时间线】\n${existingItemsText}`);
  }
  parts.push(`【第${chapterOrder}章正文】\n${chapterContent.slice(0, 6000)}`);
  parts.push("请从本章正文中提取新的事件。只输出JSON。");
  return parts.join("\n\n");
}

async function extractTimelineEvents(
  novelId: string,
  chapterId: string,
  content: string,
  chapterOrder: number,
): Promise<number> {
  const prisma = getPrisma();

  // Idempotent: delete previous extraction for this chapter before re-extracting
  await prisma.timelineItem.deleteMany({ where: { chapterId } });

  // Load existing items (excluding the just-deleted ones) for context
  const existing = await prisma.timelineItem.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
    take: 50,
  });
  const existingText = existing
    .map(e => `[sortOrder=${e.sortOrder}] [${e.category}] ${e.title}: ${e.description ?? ""}`)
    .join("\n");

  try {
    const result = await aiInvoke({
      assetId: "novel.timeline.extract",
      userPrompt: buildExtractionUserPrompt(existingText, content, chapterOrder),
      schema: ExtractionSchema,
      temperature: 0.3,
    });

    let created = 0;
    for (const evt of result.events) {
      // Compute sortOrder: use explicit if set, otherwise increment from last existing
      const sortOrder = evt.sortOrder > 0
        ? evt.sortOrder
        : (existing[existing.length - 1]?.sortOrder ?? chapterOrder * 10) + created + 1;

      await prisma.timelineItem.create({
        data: {
          novelId,
          chapterId,
          title: evt.title,
          description: evt.description,
          sortOrder,
          category: evt.category,
        },
      });
      created++;
    }
    return created;
  } catch (e) {
    logEventError("timeline.extract", { novelId, chapterId }, e);
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════
// Conflict Detection
// ═══════════════════════════════════════════════════════════

async function detectAndStoreConflicts(
  novelId: string,
  chapterId: string,
): Promise<TimelineConflict[]> {
  const prisma = getPrisma();
  const items = await prisma.timelineItem.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
  });

  if (items.length < 2) return [];

  const timelineText = items
    .map(i => `[sortOrder=${i.sortOrder}] [${i.category}] ${i.title}: ${i.description ?? ""}`)
    .join("\n");

  try {
    const result = await aiInvoke({
      assetId: "novel.timeline.conflict",
      userPrompt: `时间线数据：\n${timelineText.slice(0, 6000)}`,
      schema: ConflictSchema,
      temperature: 0.3,
    });

    const conflicts = result.conflicts;

    // Persist to AuditReport
    if (conflicts.length > 0) {
      await prisma.auditReport.create({
        data: {
          novelId,
          chapterId,
          auditType: "timeline",
          overallScore: Math.max(0, 100 - conflicts.length * 15),
          summary: `发现${conflicts.length}个时间线冲突（${conflicts.filter(c => c.severity === "high").length}个高严重度）`,
          details: JSON.stringify(conflicts),
          status: conflicts.some(c => c.severity === "high") ? "failed"
            : conflicts.some(c => c.severity === "medium") ? "warning"
            : "passed",
        },
      });

      // Mark violated timeline items
      for (const c of conflicts) {
        const itemA = items.find(i => i.title === c.itemA.title && i.sortOrder === c.itemA.sortOrder);
        const itemB = items.find(i => i.title === c.itemB.title && i.sortOrder === c.itemB.sortOrder);
        if (itemA) await prisma.timelineItem.update({ where: { id: itemA.id }, data: { status: "violated" } }).catch(() => {});
        if (itemB) await prisma.timelineItem.update({ where: { id: itemB.id }, data: { status: "violated" } }).catch(() => {});
      }
    }

    return conflicts;
  } catch (e) {
    logEventError("timeline.conflict", { novelId }, e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Context Assembly (for AI prompts)
// ═══════════════════════════════════════════════════════════

export async function getTimelineContext(
  novelId: string,
  currentChapterOrder: number,
): Promise<string> {
  const items = await getPrisma().timelineItem.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
    take: 20,
  });
  if (items.length === 0) return "";

  const before = items.filter(i => i.sortOrder <= currentChapterOrder);
  const upcoming = items.filter(i => i.sortOrder > currentChapterOrder);

  let text = "## 时间线\n";

  if (before.length > 0) {
    text += "已发生：\n";
    text += before.slice(-8).map(i => {
      const statusIcon = i.status === "violated" ? "⚠"
        : i.status === "resolved" ? "✓"
        : i.category === "deadline" && i.sortOrder < currentChapterOrder - 2 ? "⚠ 逾期" : "";
      return `- ${statusIcon} ${i.title}（${i.category} · 第${i.sortOrder}章）`;
    }).join("\n") + "\n";
  }

  if (upcoming.length > 0) {
    text += "即将发生：\n";
    text += upcoming.slice(0, 5).map(i => {
      const urgency = i.category === "deadline" ? " [不可错过]"
        : i.category === "milestone" ? " [重大节点]"
        : i.category === "constraint" ? " [时间约束]" : "";
      return `- 🔔 ${i.title}（${i.category} · 第${i.sortOrder}章）${urgency}`;
    }).join("\n");
  }

  return text;
}

// ═══════════════════════════════════════════════════════════
// Pre-Chapter Reminders (for author-facing UI)
// ═══════════════════════════════════════════════════════════

export interface ChapterReminder {
  title: string;
  category: string;
  sortOrder: number;
  status: string;
  isOverdue: boolean;
  isUpcoming: boolean;
}

export interface ChapterRemindersResult {
  reminders: ChapterReminder[];
  summary: string;
}

export async function getPreChapterReminders(
  novelId: string,
  chapterOrder: number,
): Promise<ChapterRemindersResult> {
  const items = await getPrisma().timelineItem.findMany({
    where: {
      novelId,
      status: { not: "resolved" },
    },
    orderBy: { sortOrder: "asc" },
  });

  if (items.length === 0) return { reminders: [], summary: "" };

  // Only show: overdue items + upcoming items (next 10 chapters, scaled for long-form)
  const overdue = items.filter(i =>
    (i.sortOrder < chapterOrder - 2 && i.category === "deadline" && i.status !== "resolved")
    || (i.status === "violated" && i.sortOrder < chapterOrder)
  );

  const upcoming = items.filter(i =>
    i.sortOrder > chapterOrder && i.sortOrder <= chapterOrder + 10
  );

  const relevant = [...overdue, ...upcoming];

  const reminders: ChapterReminder[] = relevant.map(i => ({
    title: i.title,
    category: i.category,
    sortOrder: i.sortOrder,
    status: i.status,
    isOverdue: overdue.some(o => o.id === i.id),
    isUpcoming: i.sortOrder > chapterOrder,
  }));

  const summary = overdue.length > 0
    ? `${overdue.length}个截止事件已逾期，${reminders.filter(r => r.isUpcoming).length}个事件即将发生`
    : reminders.filter(r => r.isUpcoming).length > 0
    ? `${reminders.filter(r => r.isUpcoming).length}个事件即将在本章附近发生`
    : "";

  return { reminders, summary };
}

// ═══════════════════════════════════════════════════════════
// UNIFIED ENTRY POINT — called by ALL chapter-write paths
// ═══════════════════════════════════════════════════════════

/** Public wrapper for manual conflict re-check (used by route + debug). */
export async function detectTimelineConflicts(novelId: string): Promise<TimelineConflict[]> {
  const prisma = getPrisma();
  const latestChapter = await prisma.chapter.findFirst({
    where: { novelId },
    orderBy: { order: "desc" },
    select: { id: true },
  });
  if (!latestChapter) return [];
  return detectAndStoreConflicts(novelId, latestChapter.id);
}

/** Manual re-extraction for a single chapter — used when author edits content. */
export async function reExtractChapterTimeline(
  novelId: string,
  chapterId: string,
): Promise<AfterChapterSaveResult> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { content: true, order: true },
  });
  if (!chapter?.content) {
    throw Object.assign(new Error("Chapter has no content"), { statusCode: 400, code: "NO_CONTENT" });
  }
  return afterChapterSave(novelId, chapterId, chapter.content, chapter.order);
}

/**
 * Execute all post-save timeline processing for a chapter.
 *
 * Callers:
 *   - chapterWriter.streamChapter()  (single-chapter SSE)
 *   - directorService.runDirector()  (batch auto-write)
 *
 * This MUST be called after chapter content is persisted to DB.
 * Fire-and-forget is acceptable; failures are logged and do not
 * block the chapter write response.
 */
export async function afterChapterSave(
  novelId: string,
  chapterId: string,
  content: string,
  chapterOrder: number,
): Promise<AfterChapterSaveResult> {
  // 1. Extract timeline events from the new chapter content
  const timelineItemsCreated = await extractTimelineEvents(
    novelId, chapterId, content, chapterOrder,
  );

  // 2. Run conflict detection against the full timeline (if new items were added)
  let conflicts: TimelineConflict[] = [];
  let hasNewConflicts = false;
  if (timelineItemsCreated > 0) {
    conflicts = await detectAndStoreConflicts(novelId, chapterId);
    hasNewConflicts = conflicts.length > 0;
  }

  return { timelineItemsCreated, conflicts, hasNewConflicts };
}
