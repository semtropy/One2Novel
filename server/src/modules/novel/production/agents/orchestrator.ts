/**
 * Agent Orchestrator — utility functions for the pipeline to orchestrate agents.
 *
 * Provides timing, retry, error collection, and pipeline context threading.
 */

import type { AgentRun, AgentPipelineStatus } from "./types";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

/**
 * Run a single agent with timing and error collection.
 * Returns the AgentRun with duration filled in.
 */
export async function runAgent<T>(
  agentFn: () => Promise<AgentRun<T>>,
  pipelineCtx: { novelId: string; chapterId: string },
  tag: string,
): Promise<AgentRun<T>> {
  const start = Date.now();
  try {
    const run = await agentFn();
    if (!run.durationMs) {
      run.durationMs = Date.now() - start;
    }
    return run;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logEventError(`agent.${tag}.unhandled`, pipelineCtx, e);
    return {
      agentId: tag,
      status: "failed",
      errors: [error],
      durationMs: Date.now() - start,
      needsUserAction: true,
    } as AgentRun<T>;
  }
}

/**
 * Aggregate agent results into a pipeline-wide status summary.
 */
export function aggregateAgentStatus<T>(runs: AgentRun<T>[]): AgentPipelineStatus {
  let partialCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  let totalDuration = 0;

  for (const run of runs) {
    totalDuration += run.durationMs ?? 0;
    if (run.status === "failed") {
      failedCount++;
      errors.push(...(run.errors ?? []));
    } else if (run.status === "partial") {
      partialCount++;
    }
  }

  return {
    allPassed: failedCount === 0,
    partialCount,
    failedCount,
    totalDurationMs: totalDuration,
    errors,
  };
}
