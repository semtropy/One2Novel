/**
 * Projection Engine — orchestrates projection writers for a committed chapter.
 *
 * After a ChapterCommit is accepted, this engine dispatches independent
 * projection writers to update downstream read models. Each writer runs
 * in parallel with semaphore throttling, with automatic retry on failure.
 *
 * Failures are logged and tracked in ProjectionRun records but never
 * block the chapter write — fire-and-forget preserved.
 */

import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { Semaphore } from "../../../../platform/concurrency/semaphore";
import { POST_WRITE_MAX_CONCURRENT } from "../../../../platform/config/constants";
import {
  getCommit,
  updateProjectionStatus,
  type CommitDetail,
} from './commitService';
import { determineRequiredWriters } from './commitRouter';
import type { ProjectionResult, ProjectionWriterName } from './projectionTypes';

// ─── Writer Registry ─────────────────────────────────────

// Lazy-loaded writer instances to avoid circular deps
const writersCache = new Map<ProjectionWriterName, { run: (commitId: string, novelId: string, chapterId: string, chapterOrder: number, content?: string, extractionResult?: Record<string, unknown>) => Promise<ProjectionResult> }>();

function getWriter(name: ProjectionWriterName) {
  if (!writersCache.has(name)) {
    switch (name) {
      case 'state': {
        const m = require('./writers/stateProjectionWriter');
        writersCache.set(name, m);
        break;
      }
      case 'index': {
        const m = require('./writers/indexProjectionWriter');
        writersCache.set(name, m);
        break;
      }
      case 'summary': {
        const m = require('./writers/summaryProjectionWriter');
        writersCache.set(name, m);
        break;
      }
      case 'memory': {
        const m = require('./writers/memoryProjectionWriter');
        writersCache.set(name, m);
        break;
      }
      case 'vector': {
        const m = require('./writers/vectorProjectionWriter');
        writersCache.set(name, m);
        break;
      }
    }
  }
  return writersCache.get(name)!;
}

// ─── Concurrency Control ─────────────────────────────────

const projectionSemaphore = new Semaphore(POST_WRITE_MAX_CONCURRENT);

// ─── Core: Run Projections ───────────────────────────────

/**
 * Run projections for an accepted commit.
 *
 * 1. Fetches the commit detail
 * 2. Determines required writers
 * 3. Creates ProjectionRun records
 * 4. Executes writers in parallel with retry
 * 5. Updates commit projection status
 */
export async function runProjections(
  commitId: string,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  content?: string,
  reviewResult?: Record<string, unknown>,
  extractionResult?: Record<string, unknown>,
): Promise<{ success: boolean; results: Record<ProjectionWriterName, ProjectionResult | null> }> {
  const prisma = getPrisma();
  const results: Record<ProjectionWriterName, ProjectionResult | null> = {
    state: null,
    index: null,
    summary: null,
    memory: null,
    vector: null,
  };

  // Use provided extraction result or fetch from DB
  let commitExtraction = extractionResult;
  if (!commitExtraction) {
    try {
      const commit = await getCommit(chapterId);
      if (commit?.extractionResult) {
        commitExtraction = JSON.parse(commit.extractionResult);
      }
    } catch (e) {
      logEventError("projection.engine.getCommit", { commitId, chapterId }, e);
    }
  }

  // Use the extraction result (passed directly or fetched from DB)
  const effectiveExtraction = commitExtraction;

  // Determine required writers
  const requiredWriters = determineRequiredWriters(effectiveExtraction);
  const writerNames = requiredWriters as ProjectionWriterName[];

  // Update commit to in_progress
  await updateProjectionStatus(chapterId, 'in_progress').catch(e =>
    logEventError("projection.engine.updateStatus", { chapterId }, e)
  );

  // Create ProjectionRun records
  const runRecords: Array<{ id: string; writerName: ProjectionWriterName }> = [];
  for (const name of writerNames) {
    try {
      const run = await prisma.projectionRun.create({
        data: {
          commitId,
          writerName: name,
          status: 'running',
          attempt: 1,
        },
      });
      runRecords.push({ id: run.id, writerName: name });
    } catch (e) {
      logEventError("projection.engine.createRun", { commitId, writerName: name }, e);
    }
  }

  // Execute writers in parallel with semaphore throttling
  const throttled = async <T>(fn: () => Promise<T>): Promise<T> => {
    await projectionSemaphore.acquire();
    try {
      return await fn();
    } finally {
      projectionSemaphore.release();
    }
  };

  const tasks = runRecords.map(({ id, writerName }) =>
    throttled(async () => {
      const writer = getWriter(writerName);
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await writer.run(
            commitId,
            novelId,
            chapterId,
            chapterOrder,
            content,
            extractionResult ?? undefined,
          );

          // Update ProjectionRun
          await prisma.projectionRun.update({
            where: { id },
            data: {
              status: result.success ? 'completed' : 'failed',
              attempt,
              completedAt: new Date(),
              durationMs: result.success ? undefined : undefined,
              error: result.error,
              resultSummary: result.success ? JSON.stringify({
                itemsProcessed: result.itemsProcessed,
                itemsCreated: result.itemsCreated,
                itemsUpdated: result.itemsUpdated,
                itemsOutdated: result.itemsOutdated,
              }) : undefined,
            },
          });

          results[writerName] = result;
          return;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);

          // Update error on last attempt
          if (attempt === maxRetries) {
            await prisma.projectionRun.update({
              where: { id },
              data: {
                status: 'failed',
                attempt,
                completedAt: new Date(),
                error: errorMsg,
              },
            }).catch(err => logEventError("projection.engine.updateRunFail", { id }, err));

            results[writerName] = {
              success: false,
              itemsProcessed: 0,
              itemsCreated: 0,
              itemsUpdated: 0,
              itemsOutdated: 0,
              error: errorMsg,
            };
          }

          if (attempt < maxRetries) {
            // Exponential backoff (1s, 2s)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
          }
        }
      }
    })
  );

  // Run all writers in parallel
  await Promise.allSettled(tasks);

  // Update commit projection status
  const completed = runRecords.filter(r => results[r.writerName]?.success);
  const failed = runRecords.filter(r => !results[r.writerName]?.success);

  if (failed.length === 0 && completed.length > 0) {
    await updateProjectionStatus(chapterId, 'completed').catch(() => {});
  } else if (completed.length > 0) {
    await updateProjectionStatus(chapterId, 'partially_completed').catch(() => {});
  } else {
    await updateProjectionStatus(chapterId, 'failed').catch(() => {});
  }

  return {
    success: failed.length === 0 && completed.length > 0,
    results,
  };
}

// ─── Replay ──────────────────────────────────────────────

/**
 * Replay failed projections for a chapter.
 */
export async function replayProjections(
  chapterId: string,
  novelId: string,
  chapterOrder: number,
  content?: string,
): Promise<number> {
  const prisma = getPrisma();

  // Find failed ProjectionRun records
  const failedRuns = await prisma.projectionRun.findMany({
    where: {
      commit: { chapterId, status: 'accepted' },
      status: { in: ['failed', 'not_started'] },
    },
    select: { id: true, writerName: true, commitId: true },
  });

  if (failedRuns.length === 0) return 0;

  const commitId = failedRuns[0].commitId;
  await runProjections(commitId, novelId, chapterId, chapterOrder, content);

  return failedRuns.length;
}

/**
 * Replay all unfinished projections for a novel.
 */
export async function replayAllUnfinished(novelId: string): Promise<number> {
  const prisma = getPrisma();

  const unfinished = await prisma.chapterCommit.findMany({
    where: {
      novelId,
      status: 'accepted',
      projectionStatus: { in: ['not_started', 'in_progress', 'partially_completed', 'failed'] },
    },
    select: { id: true, chapterId: true, chapterOrder: true, novelId: true },
  });

  let totalReplayed = 0;
  for (const commit of unfinished) {
    try {
      const result = await runProjections(
        commit.id,
        commit.novelId,
        commit.chapterId,
        commit.chapterOrder,
      );
      if (result.success) totalReplayed++;
    } catch (e) {
      logEventError("projection.replayAll", { commitId: commit.id }, e);
    }
  }

  return totalReplayed;
}

/**
 * Replay projections for chapters stuck in partially_completed or failed status
 * for more than the given staleness threshold (in chapters).
 *
 * A chapter is considered "stale" if its position lags behind the current
 * chapter order by more than stalenessThreshold. This enables automatic
 * recovery of chapters whose projection writers failed and were never retried.
 *
 * Returns the number of chapters successfully replayed.
 */
export async function replayStaleProjections(
  novelId: string,
  stalenessThreshold: number = 5,
): Promise<number> {
  const prisma = getPrisma();

  // Find commits that are accepted but stuck in bad projection status
  const staleCommits = await prisma.chapterCommit.findMany({
    where: {
      novelId,
      status: 'accepted',
      projectionStatus: { in: ['partially_completed', 'failed'] },
    },
    select: {
      id: true,
      chapterId: true,
      chapterOrder: true,
      novelId: true,
    },
    orderBy: { chapterOrder: 'asc' },
  });

  // Current max chapter order to compute staleness
  const maxOrder = await prisma.chapter.aggregate({
    where: { novelId },
    _max: { order: true },
  });
  const currentOrder = maxOrder._max.order ?? 0;

  let replayed = 0;
  for (const commit of staleCommits) {
    // Skip if the commit was recently completed (within staleness threshold)
    const staleness = currentOrder - commit.chapterOrder;
    if (staleness < stalenessThreshold) continue;

    try {
      const result = await runProjections(
        commit.id,
        commit.novelId,
        commit.chapterId,
        commit.chapterOrder,
      );
      if (result.success) replayed++;
    } catch (e) {
      logEventError("projection.replayStale", { chapterId: commit.chapterId }, e);
    }
  }

  return replayed;
}
