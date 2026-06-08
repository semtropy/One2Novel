/**
 * Chapter Content Finalization — snapshot + consistency check before save.
 *
 * ADAPTED from OP ChapterContentFinalizationService.ts (164 lines).
 *
 * Flow:
 *   1. Collect pre-save snapshot (character states, payoff statuses, timeline)
 *   2. Compare with current state to detect inconsistencies
 *   3. Save snapshot to DB for audit trail
 *   4. Return consistency report
 */

import { getPrisma } from "../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface ChapterSnapshot {
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  characters: SnapshotCharacter[];
  payoffs: SnapshotPayoff[];
  timelineItems: SnapshotTimelineItem[];
}

interface SnapshotCharacter {
  name: string;
  currentGoal: string | null;
  currentLocation: string | null;
  availability: string | null;
}

interface SnapshotPayoff {
  title: string;
  status: string;
}

interface SnapshotTimelineItem {
  event: string;
  chapterOrder: number;
}

export interface ConsistencyIssue {
  severity: "high" | "medium" | "low";
  type: string;
  description: string;
}

export interface FinalizationResult {
  snapshot: ChapterSnapshot;
  consistencyIssues: ConsistencyIssue[];
  /** Whether the chapter is safe to finalize */
  canFinalize: boolean;
  summary: string;
}

// ─── Snapshot collection ───────────────────────────────

async function collectCharacterStates(novelId: string): Promise<SnapshotCharacter[]> {
  const prisma = getPrisma();
  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { name: true, currentGoal: true, currentLocation: true, availability: true },
  });
  return characters;
}

async function collectPayoffStates(novelId: string): Promise<SnapshotPayoff[]> {
  const prisma = getPrisma();
  const payoffs = await prisma.payoffLedgerItem.findMany({
    where: { novelId },
    select: { title: true, currentStatus: true },
  });
  return payoffs.map(p => ({ title: p.title, status: p.currentStatus }));
}

async function collectTimelineState(novelId: string): Promise<SnapshotTimelineItem[]> {
  const prisma = getPrisma();
  const items = await prisma.timelineItem.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
    select: { title: true, sortOrder: true },
  });
  return items.map(i => ({ event: i.title, chapterOrder: i.sortOrder }));
}

// ─── Consistency checks ────────────────────────────────

/** Check for stale/inconsistent character states across chapters */
function checkCharacterConsistency(
  characters: SnapshotCharacter[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const char of characters) {
    // Characters with goals should have consistent availability
    if (char.currentGoal && !char.availability) {
      issues.push({
        severity: "low",
        type: "角色状态不完整",
        description: `${char.name} 有当前目标「${char.currentGoal}」，但未设置可用性状态。`,
      });
    }
  }

  return issues;
}

/** Check for overdue payoffs */
function checkPayoffConsistency(payoffs: SnapshotPayoff[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  const setupCount = payoffs.filter(p => p.status === "setup").length;
  const hintedCount = payoffs.filter(p => p.status === "hinted").length;
  const overdue = setupCount + hintedCount;

  if (overdue > 8) {
    issues.push({
      severity: "medium",
      type: "伏笔积压",
      description: `存在${setupCount}项已设置和${hintedCount}项已暗示的伏笔（共${overdue}项），超过8项阈值。部分伏笔可能被遗忘。`,
    });
  }

  return issues;
}

/** Check timeline event ordering */
function checkTimelineConsistency(
  items: SnapshotTimelineItem[],
  currentChapterOrder: number,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  // Events from future chapters shouldn't exist
  const futureEvents = items.filter(i => i.chapterOrder > currentChapterOrder);
  if (futureEvents.length > 0) {
    issues.push({
      severity: "medium",
      type: "时间线异常",
      description: `发现${futureEvents.length}条时间线事件标注为未来章节（>第${currentChapterOrder}章），可能存在时间顺序错误。`,
    });
  }

  return issues;
}

// ─── Main entry ────────────────────────────────────────

export async function createChapterSnapshot(
  novelId: string,
  chapterId: string,
  chapterOrder: number,
): Promise<ChapterSnapshot> {
  const [characters, payoffs, timelineItems] = await Promise.all([
    collectCharacterStates(novelId),
    collectPayoffStates(novelId),
    collectTimelineState(novelId),
  ]);

  const snapshot: ChapterSnapshot = {
    novelId,
    chapterId,
    chapterOrder,
    characters,
    payoffs,
    timelineItems,
  };

  // Persist snapshot to DB
  const prisma = getPrisma();
  await prisma.chapter.update({
    where: { id: chapterId },
    data: {
      sceneCards: JSON.stringify({
        snapshotVersion: 1,
        timestamp: new Date().toISOString(),
        characterCount: characters.length,
        payoffCount: payoffs.length,
        timelineCount: timelineItems.length,
      }),
    },
  });

  return snapshot;
}

export function checkSnapshotConsistency(
  snapshot: ChapterSnapshot,
): ConsistencyIssue[] {
  return [
    ...checkCharacterConsistency(snapshot.characters),
    ...checkPayoffConsistency(snapshot.payoffs),
    ...checkTimelineConsistency(snapshot.timelineItems, snapshot.chapterOrder),
  ];
}

export async function finalizeChapter(
  novelId: string,
  chapterId: string,
  chapterOrder: number,
): Promise<FinalizationResult> {
  const snapshot = await createChapterSnapshot(novelId, chapterId, chapterOrder);
  const consistencyIssues = checkSnapshotConsistency(snapshot);

  const hasHighSeverity = consistencyIssues.some(i => i.severity === "high");
  const hasMediumSeverity = consistencyIssues.some(i => i.severity === "medium");

  let summary: string;
  if (consistencyIssues.length === 0) {
    summary = "定稿前检查通过，未发现一致性问题。";
  } else if (!hasHighSeverity && !hasMediumSeverity) {
    summary = `定稿前检查发现${consistencyIssues.length}项轻微问题，可安全定稿。`;
  } else if (!hasHighSeverity) {
    summary = `定稿前检查发现${consistencyIssues.length}项问题（含中等严重度），建议确认后定稿。`;
  } else {
    summary = `定稿前检查发现严重一致性问题，建议延迟定稿并修复。`;
  }

  return {
    snapshot,
    consistencyIssues,
    canFinalize: !hasHighSeverity,
    summary,
  };
}
