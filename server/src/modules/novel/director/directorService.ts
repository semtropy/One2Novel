import { EventEmitter } from "node:events";
import { getPrisma } from "../../../platform/db/client";
import { novelEventBus } from "../../../platform/events/bus";
import { processChapter } from "../production/chapterPipeline";
import { generateChapterContentCore } from "../production/chapterGenerator";
import { saveCheckpoint, clearCheckpoint, type DirectorCheckpoint } from "./checkpointService";

export const directorEmitter = new EventEmitter();
directorEmitter.setMaxListeners(50);  // M8: prevent MaxListenersExceededWarning under concurrent SSE connections

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

export async function runDirector(novelId: string, maxChapters?: number): Promise<DirectorProgress> {
  // C1: Guard against concurrent runs for the same novel
  const existing = progressMap.get(novelId);
  if (existing?.stage === "running") {
    throw new Error(`Director already running for novel ${novelId}`);
  }

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

  // F1: persisted checkpoint for resume after crash
  let checkpointTaskId: string | undefined;
  const completedIds: string[] = [];
  const failedIds: string[] = [];

  try {
    // Initial checkpoint
    checkpointTaskId = await saveCheckpoint(novelId, {
      novelId,
      completedChapterIds: [],
      failedChapterIds: [],
      currentChapterOrder: 0,
      totalChaptersToWrite: chaptersToWrite.length,
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      stage: "running",
    });

    for (const chapter of chaptersToWrite) {
      if (stopFlags.get(novelId)) {
        stopFlags.delete(novelId);
        progress.stage = "paused";
        progress.message = `已在第${progress.currentChapter}章停止`;
        clearCheckpoint(novelId);
        return progress;
      }
      progress.currentChapter = chapter.order;
      progress.message = `正在写第${chapter.order}章《${chapter.title}》...`;

      try {
        let content: string;
        try {
          content = await Promise.race([
            generateChapterContent(novelId, chapter.id, chapter.order),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("生成超时（120秒）。建议：减少每章目标字数或稍后重试")), 120000)),
          ]);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          if (msg.includes("超时") || msg.includes("timeout")) {
            throw new Error(`第${chapter.order}章生成超时：AI 响应过慢。建议稍后重试或减少章节字数。`);
          }
          throw e;
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

        // Persist checkpoint after each chapter
        saveCheckpoint(novelId, {
          novelId,
          taskId: checkpointTaskId,
          completedChapterIds: completedIds,
          failedChapterIds: failedIds,
          currentChapterOrder: chapter.order,
          totalChaptersToWrite: progress.totalChapters,
          startedAt: new Date().toISOString(),
          lastCheckpointAt: new Date().toISOString(),
          stage: "running",
        }).catch(() => {}); // Fire-and-forget: don't block chapter loop
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress.stage = "blocked";
        progress.message = `第${chapter.order}章失败：${msg}`;
        progress.results.push({ chapter: chapter.order, status: "blocked", error: msg });
        progressMap.set(novelId, progress);
        directorEmitter.emit("error", { novelId, message: msg });
        // Save blocked checkpoint so user can resume
        saveCheckpoint(novelId, {
          novelId,
          taskId: checkpointTaskId,
          completedChapterIds: completedIds,
          failedChapterIds: [...failedIds, chapter.id],
          currentChapterOrder: chapter.order,
          totalChaptersToWrite: progress.totalChapters,
          startedAt: new Date().toISOString(),
          lastCheckpointAt: new Date().toISOString(),
          stage: "blocked",
        }).catch(() => {});
        return progress;
      }
    }

    progress.stage = "completed";
    progress.message = `全部 ${progress.totalChapters} 章完成`;
    directorEmitter.emit("done", { novelId, total: progress.totalChapters });
    // Clear checkpoint on clean completion
    clearCheckpoint(novelId, checkpointTaskId).catch(() => {});
  } finally {
    progressMap.set(novelId, progress);
    // Keep progressMap entry for 5 min so clients can poll — checkpoint persists in DB
    setTimeout(() => progressMap.delete(novelId), 300000);
  }

  return progress;
}

async function generateChapterContent(novelId: string, chapterId: string, chapterOrder: number): Promise<string> {
  return generateChapterContentCore(novelId, chapterId, {
    onToken: (text) => directorEmitter.emit("token", { novelId, text, chapterOrder }),
  });
}

