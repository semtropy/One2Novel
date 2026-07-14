import { EventEmitter } from "node:events";
import { getPrisma } from "../../../platform/db/client";
import { novelEventBus } from "../../../platform/events/bus";
import { logEventError } from "../../../platform/logging/eventErrorLog";
import { processChapter } from "../production/writing/chapterPipeline";
import { generateChapterContentCore } from "../production/writing/chapterGenerator";
import { saveCheckpoint, clearCheckpoint, loadCheckpoint } from "./checkpointService";
import {
  CHAPTER_TIMEOUT_MS,
  DIRECTOR_BATCH_LIMIT,
  DIRECTOR_MAX_LISTENERS,
  DIRECTOR_PROGRESS_IDLE_TTL,
} from "../../../platform/config/constants";

export const directorEmitter = new EventEmitter();
directorEmitter.setMaxListeners(DIRECTOR_MAX_LISTENERS);

export interface DirectorProgress {
  novelId: string;
  stage: "idle" | "running" | "paused" | "completed" | "blocked";
  currentChapter: number;
  totalChapters: number;
  message: string;
  results: Array<{ chapter: number; status: string; score?: number; error?: string }>;
}

const progressMap = new Map<string, DirectorProgress>();
const stopFlags = new Map<string, boolean>();

export async function stopDirector(novelId: string): Promise<boolean> {
  const p = progressMap.get(novelId);
  if (p?.stage === "running") {
    stopFlags.set(novelId, true);
    // Persist stop flag to checkpoint for crash recovery
    const { saveCheckpoint, loadCheckpoint } = await import("./checkpointService");
    const cp = await loadCheckpoint(novelId);
    if (cp) {
      await saveCheckpoint(novelId, { ...cp, stopRequested: true }).catch(e => logEventError("director.checkpoint.stopFlag", { novelId }, e)); // intentional: fire-and-forget, failure tolerated
    }
    return true;
  }
  return false;
}

export function getDirectorProgress(novelId: string): DirectorProgress | null {
  return progressMap.get(novelId) ?? null;
}

/** Prevent a new run if a checkpoint from a previous (possibly crashed) run still exists with stage "running" */
async function guardAgainstStaleRun(novelId: string): Promise<void> {
  const checkpoint = await loadCheckpoint(novelId).catch(() => null);
  if (checkpoint?.stage === "running") {
    throw new Error(
      `检测到未完成的自动写作任务（上次中断于第 ${checkpoint.currentChapterOrder} 章）。请先点击「续写」恢复之前的任务，或手动清除断点后再开始新的自动写作。`
    );
  }
}

export async function runDirector(novelId: string, maxChapters?: number): Promise<DirectorProgress> {
  // Guard against concurrent in-memory runs
  const existing = progressMap.get(novelId);
  if (existing?.stage === "running") {
    throw new Error(`Director already running for novel ${novelId}`);
  }

  // Guard against stale runs from previous server instance
  await guardAgainstStaleRun(novelId);

  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
  if (!novel) throw new Error("Novel not found");

  const startIdx = novel.chapters.findIndex((c: { chapterStatus: string }) => c.chapterStatus !== "completed");
  const batchLimit = maxChapters ?? DIRECTOR_BATCH_LIMIT; // Cap at 30 chapters per director run for long-form
  const chaptersToWrite = startIdx >= 0 ? novel.chapters.slice(startIdx, startIdx + batchLimit) : [];

  const progress: DirectorProgress = {
    novelId, stage: "running", currentChapter: 0,
    totalChapters: chaptersToWrite.length,
    message: `开始自动写作（共${chaptersToWrite.length}章）...`,
    results: [],
  };
  progressMap.set(novelId, progress);

  let checkpointTaskId: string | undefined;
  const completedIds: string[] = [];
  const failedIds: string[] = [];

  const saveCp = (stage: "running" | "blocked" | "completed" | "paused", extra?: Record<string, unknown>) =>
    saveCheckpoint(novelId, {
      novelId, taskId: checkpointTaskId,
      completedChapterIds: completedIds, failedChapterIds: failedIds,
      currentChapterOrder: progress.currentChapter,
      totalChaptersToWrite: progress.totalChapters,
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      stage,
      ...extra,
    }).catch(e => logEventError("director.checkpoint", { novelId, stage }, e));

  try {
    // Initial checkpoint
    checkpointTaskId = await saveCheckpoint(novelId, {
      novelId,
      completedChapterIds: [], failedChapterIds: [],
      currentChapterOrder: 0, totalChaptersToWrite: chaptersToWrite.length,
      startedAt: new Date().toISOString(), lastCheckpointAt: new Date().toISOString(),
      stage: "running",
    });

    // Check persisted stop flag from previous run
    const existingCp = await loadCheckpoint(novelId);
    if (existingCp?.stopRequested) {
      progress.stage = "paused";
      progress.message = `检测到已请求停止，跳过执行`;
      await clearCheckpoint(novelId).catch(e => logEventError("director.clearCheckpoint", { novelId }, e));
      return progress;
    }

    for (const chapter of chaptersToWrite) {
      if (stopFlags.get(novelId)) {
        stopFlags.delete(novelId);
        progress.stage = "paused";
        progress.message = `已在第${progress.currentChapter}章停止`;
        await saveCp("paused", { stopRequested: true });
        await clearCheckpoint(novelId).catch(e => logEventError("director.clearCheckpoint", { novelId }, e));
        return progress;
      }
      progress.currentChapter = chapter.order;
      progress.message = `正在写第${chapter.order}章《${chapter.title}》...`;

      try {
        // Use AbortController to properly cancel the underlying LLM stream on timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), CHAPTER_TIMEOUT_MS);

        let content: string;
        try {
          content = await Promise.race([
            generateChapterContent(novelId, chapter.id, chapter.order, abortController.signal),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("生成超时（120秒）。建议：减少每章目标字数或稍后重试")), CHAPTER_TIMEOUT_MS)
            ),
          ]);
        } finally {
          clearTimeout(timeoutId);
        }

        // Save content snapshot to checkpoint BEFORE persisting (crash recovery)
        await saveCp("running", { pendingChapterContent: content, pendingChapterTitle: chapter.title }).catch(e => logEventError("director.checkpoint.pendingContent", { novelId, chapterOrder: chapter.order }, e)); // intentional: fire-and-forget, failure tolerated

        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { content, chapterStatus: "drafted", actualWordCount: content.length },
        });

        // Run full chapter pipeline: quality → repair → persist → hooks
        const pipelineResult = await processChapter(novelId, chapter.id, content, chapter.order);
        // Clear pending content after successful pipeline completion
        await saveCp("running", { pendingChapterContent: null, pendingChapterTitle: null }).catch(e => logEventError("director.checkpoint.clearPending", { novelId, chapterOrder: chapter.order }, e)); // intentional: fire-and-forget, failure tolerated
        const finalStatus = pipelineResult.status;
        const finalScore = pipelineResult.score;

        if (finalStatus === "completed") {
          completedIds.push(chapter.id);
          await novelEventBus.emit("chapter.completed", { novelId, chapterId: chapter.id });
        } else {
          failedIds.push(chapter.id);
        }
        progress.results.push({ chapter: chapter.order, status: finalStatus, score: Math.round(finalScore) });
        directorEmitter.emit("chapter", { novelId, order: chapter.order, total: progress.totalChapters });

        // Auto-pause at loop settlement boundary
        const chapterPlan = await prisma.volumeChapterPlan.findFirst({
          where: { chapterId: chapter.id },
          select: { loopPhase: true, loopIndex: true },
        });
        if (chapterPlan?.loopPhase === "settlement") {
          progress.stage = "paused";
          progress.message = `第${chapterPlan.loopIndex ?? "?"}轮回环已完成（结算阶段），暂停等待确认。点击「继续」开始下一轮回环。`;
          stopFlags.set(novelId, true);
          await saveCp("paused");
          return progress;
        }

        // Persist checkpoint after each chapter
        await saveCp("running");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress.stage = "blocked";
        progress.message = `第${chapter.order}章失败：${msg}`;
        progress.results.push({ chapter: chapter.order, status: "blocked", error: msg });
        progressMap.set(novelId, progress);
        directorEmitter.emit("error", { novelId, message: msg });
        await saveCp("blocked");
        return progress;
      }
    }

    // Mark novel as completed when all chapters are done
    await prisma.novel.update({
      where: { id: novelId },
      data: { projectStatus: "completed" },
    }).catch(e => logEventError("director.projectComplete", { novelId }, e));

    progress.stage = "completed";
    progress.message = `全部 ${progress.totalChapters} 章完成`;
    directorEmitter.emit("done", { novelId, total: progress.totalChapters });
    clearCheckpoint(novelId, checkpointTaskId).catch(e => logEventError("director.clearCheckpoint", { novelId }, e));
  } finally {
    progressMap.set(novelId, progress);
    setTimeout(() => progressMap.delete(novelId), DIRECTOR_PROGRESS_IDLE_TTL);
  }

  return progress;
}

async function generateChapterContent(
  novelId: string, chapterId: string, chapterOrder: number, signal?: AbortSignal
): Promise<string> {
  return generateChapterContentCore(novelId, chapterId, {
    onToken: (text) => directorEmitter.emit("token", { novelId, text, chapterOrder }),
    signal,
  });
}

