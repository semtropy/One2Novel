/**
 * ReviewerAgent — wraps runQualityGate with lifecycle tracking and retry.
 *
 * This is a thin wrapper around the existing qualityGate.ts. No changes
 * to the quality gate logic itself — just adds timing, retry on failure,
 * and consistent error output via AgentRun<QualityResult>.
 */

import { runQualityGate, totalQualityScore, type QualityResult, type QualityGateOptions } from "../quality/qualityGate";
import type { AgentRun } from "./types";

export interface ReviewerAgentOptions {
  maxRetries?: number;
}

/**
 * Run the ReviewerAgent for a chapter.
 *
 * Wraps runQualityGate() with retry on failure (up to 2 retries,
 * exponential backoff). Returns a standardized AgentRun<QualityResult>
 * with lifecycle tracking.
 *
 * On total failure, returns a fallback with default scores (5/10 per
 * dimension) so the pipeline can proceed.
 */
export async function runReviewerAgent(
  content: string,
  options: QualityGateOptions,
  agentOpts: ReviewerAgentOptions = {},
): Promise<AgentRun<QualityResult>> {
  const start = Date.now();
  const maxRetries = agentOpts.maxRetries ?? 2;
  const result: AgentRun<QualityResult> = {
    agentId: "reviewer",
    status: "completed",
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const qualityResult = await runQualityGate(content, options);
      result.output = qualityResult;
      result.durationMs = Date.now() - start;
      return result;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  }

  result.status = "failed";
  result.errors = [lastError?.message ?? "Quality gate invocation failed"];
  result.durationMs = Date.now() - start;
  result.needsUserAction = true;

  // Fallback with default scores so pipeline can continue
  result.fallback = {
    openingScore: 5, plotScore: 5, characterScore: 5, dialogueScore: 5,
    suspenseScore: 5, pacingScore: 5, showNotTellScore: 5, languageScore: 5,
    genreScore: 5, coherenceScore: 5,
    overallComment: "Quality gate failed; default scores applied.",
    verdict: "NEEDS_FIX",
    issues: [],
    dimensionResults: [],
  };
  return result;
}
