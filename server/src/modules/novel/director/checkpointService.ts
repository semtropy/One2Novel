import { getPrisma } from "../../../platform/db/client";

// ─── Types ──────────────────────────────────────────

export interface DirectorCheckpoint {
  taskId: string;
  novelId: string;
  completedChapterIds: string[];
  failedChapterIds: string[];
  currentChapterOrder: number;
  totalChaptersToWrite: number;
  startedAt: string;
  lastCheckpointAt: string;
  stage: "running" | "blocked" | "completed";
}

// ─── Public API ────────────────────────────────────

/** Save or update checkpoint after each chapter completes */
export async function saveCheckpoint(
  novelId: string,
  snapshot: Omit<DirectorCheckpoint, "taskId"> & { taskId?: string },
): Promise<string> {
  const prisma = getPrisma();
  const now = new Date().toISOString();

  const data = {
    result: JSON.stringify({
      ...snapshot,
      lastCheckpointAt: now,
    }),
    progress: Math.round(
      (snapshot.completedChapterIds.length / Math.max(snapshot.totalChaptersToWrite, 1)) * 100,
    ),
    stage: snapshot.stage === "blocked" ? "第" + snapshot.currentChapterOrder + "章失败" : "写作中",
    status: snapshot.stage === "blocked" ? "failed" as const : "running" as const,
  };

  if (snapshot.taskId) {
    await prisma.backgroundTask.update({
      where: { id: snapshot.taskId },
      data,
    });
    return snapshot.taskId;
  }

  // Create new task record
  const task = await prisma.backgroundTask.create({
    data: {
      novelId,
      type: "director_run",
      status: data.status,
      progress: data.progress,
      stage: data.stage,
      result: data.result,
    },
  });
  return task.id;
}

/** Load incomplete director checkpoint for a novel */
export async function loadCheckpoint(novelId: string): Promise<DirectorCheckpoint | null> {
  const prisma = getPrisma();
  const task = await prisma.backgroundTask.findFirst({
    where: { novelId, type: "director_run", status: { in: ["running", "failed"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!task?.result) return null;

  try {
    const parsed = JSON.parse(task.result);
    return { taskId: task.id, ...parsed };
  } catch {
    return null;
  }
}

/** Clear checkpoint on successful completion */
export async function clearCheckpoint(novelId: string, taskId?: string): Promise<void> {
  const prisma = getPrisma();
  if (taskId) {
    await prisma.backgroundTask.update({
      where: { id: taskId },
      data: { status: "succeeded", progress: 100, stage: "全部完成" },
    });
    return;
  }
  // Bulk-clear all running director tasks for this novel
  await prisma.backgroundTask.updateMany({
    where: { novelId, type: "director_run", status: "running" },
    data: { status: "succeeded", progress: 100 },
  });
}
