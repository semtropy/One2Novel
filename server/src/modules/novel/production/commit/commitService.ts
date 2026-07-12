/**
 * Commit Service — manages ChapterCommit lifecycle.
 *
 * An immutable commit artifact captures the chapter's final state
 * (quality gate snapshot, extraction results) at the moment it's
 * accepted. Projections read from this artifact to update downstream
 * read models.
 *
 * Once a commit's status moves to "accepted" or "rejected", it never
 * goes back — the commit is finalized.
 */

import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

// ─── Types ───────────────────────────────────────────────

export type CommitStatus = 'pending' | 'accepted' | 'rejected';
export type ProjectionStatus = 'not_started' | 'in_progress' | 'completed' | 'partially_completed' | 'failed';

export interface CreateCommitInput {
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  qualityScore?: number;
  verdict?: string;
  reviewResult?: Record<string, unknown>;
  extractionResult?: Record<string, unknown>;
}

export interface CommitDetail {
  id: string;
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  qualityScore: number | null;
  verdict: string | null;
  reviewResult: string | null;
  extractionResult: string | null;
  status: string;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  projectionStatus: string;
  projectionStartedAt: Date | null;
  projectionCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  projectionRuns: Array<{
    id: string;
    writerName: string;
    status: string;
    attempt: number;
    startedAt: Date;
    completedAt: Date | null;
    durationMs: number | null;
    error: string | null;
    resultSummary: string | null;
  }>;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Create a new ChapterCommit with quality gate snapshot.
 * Status starts as "pending"; call acceptCommit() to finalize.
 */
export async function createCommit(input: CreateCommitInput): Promise<string> {
  const prisma = getPrisma();
  const commit = await prisma.chapterCommit.create({
    data: {
      novelId: input.novelId,
      chapterId: input.chapterId,
      chapterOrder: input.chapterOrder,
      qualityScore: input.qualityScore ?? null,
      verdict: input.verdict ?? null,
      reviewResult: input.reviewResult ? JSON.stringify(input.reviewResult) : null,
      extractionResult: input.extractionResult ? JSON.stringify(input.extractionResult) : null,
      status: 'pending',
      projectionStatus: 'not_started',
    },
  });
  return commit.id;
}

/**
 * Accept a commit — marks it as the final record for this chapter.
 * Resets projection status so projections can run.
 */
export async function acceptCommit(chapterId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.chapterCommit.updateMany({
    where: { chapterId, status: 'pending' },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
      projectionStatus: 'not_started',
    },
  });
}

/**
 * Reject a commit with a reason.
 */
export async function rejectCommit(chapterId: string, reason: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.chapterCommit.updateMany({
    where: { chapterId, status: 'pending' },
    data: {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });
}

/**
 * Get a commit by chapter ID, including its projection runs.
 */
export async function getCommit(chapterId: string): Promise<CommitDetail | null> {
  const prisma = getPrisma();
  const commit = await prisma.chapterCommit.findUnique({
    where: { chapterId },
    include: {
      projectionRuns: {
        orderBy: { startedAt: 'asc' },
        select: {
          id: true,
          writerName: true,
          status: true,
          attempt: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          error: true,
          resultSummary: true,
        },
      },
    },
  });
  return commit;
}

/**
 * Update projection status for a commit.
 */
export async function updateProjectionStatus(
  chapterId: string,
  status: ProjectionStatus,
): Promise<void> {
  const prisma = getPrisma();
  const data: Record<string, unknown> = { projectionStatus: status };
  if (status === 'in_progress') {
    data.projectionStartedAt = new Date();
  }
  if (status === 'completed' || status === 'failed' || status === 'partially_completed') {
    data.projectionCompletedAt = new Date();
  }
  await prisma.chapterCommit.updateMany({
    where: { chapterId, status: 'accepted' },
    data,
  });
}
