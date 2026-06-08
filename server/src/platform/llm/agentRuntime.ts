import { novelEventBus } from "../events/bus";
import { getPrisma } from "../db/client";

/** Agent Runtime: unified execution state tracking for long-running AI operations */
type RunState = "idle" | "running" | "paused" | "completed" | "failed";

interface AgentRun {
  id: string;
  novelId: string;
  type: string;
  state: RunState;
  progress: number;
  stage: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

const runs = new Map<string, AgentRun>();

export const agentRuntime = {
  create(novelId: string, type: string): string {
    const id = `run-${Date.now()}`;
    runs.set(id, { id, novelId, type, state: "running", progress: 0, stage: "initializing", startedAt: new Date() });
    return id;
  },

  update(id: string, update: Partial<AgentRun>) {
    const run = runs.get(id);
    if (run) runs.set(id, { ...run, ...update });
  },

  get(id: string) { return runs.get(id); },

  getByNovel(novelId: string) {
    return [...runs.values()].filter(r => r.novelId === novelId && r.state === "running");
  },

  /** Emit progress event for frontend polling */
  progress(id: string, progress: number, stage: string) {
    this.update(id, { progress, stage });
    const run = runs.get(id);
    if (run) novelEventBus.emit("agent.progress", { runId: id, novelId: run.novelId, progress, stage }).catch(() => {});
  },

  complete(id: string) {
    this.update(id, { state: "completed", progress: 100, completedAt: new Date() });
  },

  fail(id: string, error: string) {
    this.update(id, { state: "failed", error });
  },
};

/** Background task queue: enqueue work that runs async with progress tracking */
const taskQueue: Array<{ id: string; novelId: string; type: string; fn: () => Promise<void> }> = [];
let processing = false;

export const taskQueue2 = {
  enqueue(novelId: string, type: string, fn: () => Promise<void>): string {
    const id = agentRuntime.create(novelId, type);
    taskQueue.push({ id, novelId, type, fn });
    if (!processing) processQueue();
    return id;
  },

  getProgress(id: string) { return agentRuntime.get(id); },

  getNovelTasks(novelId: string) { return agentRuntime.getByNovel(novelId); },
};

async function processQueue() {
  processing = true;
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    try {
      agentRuntime.progress(task.id, 10, "starting");
      await task.fn();
      agentRuntime.complete(task.id);
    } catch (e) {
      agentRuntime.fail(task.id, e instanceof Error ? e.message : "Task failed");
    }
  }
  processing = false;
}
