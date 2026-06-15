import { EventEmitter } from "node:events";
import { getPrisma } from "../../../platform/db/client";
import { novelEventBus } from "../../../platform/events/bus";
import { logEventError } from "../../../platform/logging/eventErrorLog";
import { processChapter } from "../production/writing/chapterPipeline";
import { generateChapterContentCore } from "../production/writing/chapterGenerator";
import { saveCheckpoint, clearCheckpoint, loadCheckpoint } from "./checkpointService";
import { checkBudget } from "../production/costTracker";

export const directorEmitter = new EventEmitter();
directorEmitter.setMaxListeners(50);

const CHAPTER_TIMEOUT_MS = 120_000;

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

export function stopDirector(novelId: string): boolean {
  const p = progressMap.get(novelId);
  if (p?.stage === "running") { stopFlags.set(novelId, true); return true; }
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

  const startIdx = novel.chapters.findIndex(c => c.chapterStatus !== "completed");
  const chaptersToWrite = startIdx >= 0 ? novel.chapters.slice(startIdx, startIdx + (maxChapters ?? novel.chapters.length)) : [];

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

    for (const chapter of chaptersToWrite) {
      if (stopFlags.get(novelId)) {
        stopFlags.delete(novelId);
        progress.stage = "paused";
        progress.message = `已在第${progress.currentChapter}章停止`;
        clearCheckpoint(novelId).catch(e => logEventError("director.clearCheckpoint", { novelId }, e));
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

        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { content, chapterStatus: "drafted", actualWordCount: content.length },
        });

        // Run full chapter pipeline: quality → repair → persist → hooks
        const pipelineResult = await processChapter(novelId, chapter.id, content, chapter.order);
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

        // Check budget limit
        const budgetWarning = await checkBudget(novelId).catch(e => {
          logEventError("director.budget", { novelId }, e);
          return null;
        });
        if (budgetWarning?.includes("已达到预算上限")) {
          progress.stage = "paused";
          progress.message = budgetWarning;
          stopFlags.set(novelId, true);
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

    progress.stage = "completed";
    progress.message = `全部 ${progress.totalChapters} 章完成`;
    directorEmitter.emit("done", { novelId, total: progress.totalChapters });
    clearCheckpoint(novelId, checkpointTaskId).catch(e => logEventError("director.clearCheckpoint", { novelId }, e));
  } finally {
    progressMap.set(novelId, progress);
    setTimeout(() => progressMap.delete(novelId), 300_000);
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

