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
  stage: "running" | "blocked" | "completed" | "paused";
}

// ─── Public API ────────────────────────────────────

/** Save or update checkpoint after each chapter completes */
export async function saveCheckpoint(
  novelId: string,
  snapshot: Omit<DirectorCheckpoint, "taskId"> & { taskId?: string },
): Promise<string> {
  const prisma = getPrisma();
  const taskId = snapshot.taskId ?? `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const checkpoint: DirectorCheckpoint = {
    ...snapshot,
    taskId,
    lastCheckpointAt: new Date().toISOString(),
  };

  await prisma.novel.update({
    where: { id: novelId },
    data: { directorCheckpoint: JSON.stringify(checkpoint) },
  });

  return taskId;
}

/** Load incomplete director checkpoint for a novel */
export async function loadCheckpoint(novelId: string): Promise<DirectorCheckpoint | null> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { directorCheckpoint: true },
  });

  if (!novel?.directorCheckpoint) return null;

  try {
    const parsed = JSON.parse(novel.directorCheckpoint) as DirectorCheckpoint;
    if (parsed.stage === "completed") return null; // completed checkpoints are dead
    return parsed;
  } catch {
    return null;
  }
}

/** Clear checkpoint on successful completion or stop */
export async function clearCheckpoint(novelId: string, _taskId?: string): Promise<void> {
  const prisma = getPrisma();
  // Mark as completed in the JSON so resume doesn't pick it up
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { directorCheckpoint: true },
  });
  if (!novel?.directorCheckpoint) return;

  try {
    const cp = JSON.parse(novel.directorCheckpoint) as DirectorCheckpoint;
    cp.stage = "completed";
    cp.lastCheckpointAt = new Date().toISOString();
    await prisma.novel.update({
      where: { id: novelId },
      data: { directorCheckpoint: JSON.stringify(cp) },
    });
  } catch {
    // If JSON is corrupt, just clear it
    await prisma.novel.update({
      where: { id: novelId },
      data: { directorCheckpoint: null },
    });
  }
}
