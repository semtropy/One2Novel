/**
 * Agent Types — shared interfaces for the Phase 4 sub-agent architecture.
 *
 * Mirrors wNW's SubagentRun pattern: every agent run records status,
 * timing, and errors. Agents wrap existing pipeline functions and
 * return standardized results that the orchestrator can reason about.
 */

import type { QualityResult } from "../quality/qualityGate";

// ─── AgentRun: Lifecycle tracking ─────────────────────────

export interface AgentRun<Output = unknown> {
  /** Agent identifier */
  agentId: string; // "context" | "reviewer" | "data"
  /** Overall status */
  status: "completed" | "partial" | "failed";
  /** Duration in ms */
  durationMs?: number;
  /** Errors encountered */
  errors?: string[];
  /** Whether the agent auto-handled the issue */
  autoHandled?: boolean;
  /** Whether user intervention is needed */
  needsUserAction?: boolean;
  /** The actual output (present when status !== "failed") */
  output?: Output;
  /** Fallback output when the agent degrades gracefully */
  fallback?: Output;
}

// ─── PipelineContext: Shared state through the pipeline ───

export interface PipelineContext {
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  /** Produced by ContextAgent */
  writingTaskBrief?: WritingTaskBrief;
  /** Produced by ReviewerAgent */
  qualityResult?: QualityResult;
  /** Produced by DataAgent */
  extractionResult?: Record<string, unknown>;
  /** Raw chapter content (set by caller) */
  content?: string;
}

// ─── WritingTaskBrief: 5-part structured output ──────────

export interface WritingTaskBrief {
  /** 1. Story goal: what this chapter must achieve narratively */
  storyGoal: string;
  /** 2. Character states and motivations for this chapter */
  characterStates: Array<{
    name: string;
    status: string;
    location: string;
    goal: string;
    motivation: string;
  }>;
  /** 3. Plot nodes that must be hit and constraints */
  plotNodes: Array<{
    node: string;
    constraint: string;
    priority: "required" | "preferred" | "nice_to_have";
  }>;
  /** 4. Style guidance from style contract + reference analysis */
  styleGuidance: string;
  /** 5. Ending direction: what the chapter should lead toward */
  endingDirection: string;
  /** Raw context blocks (preserved for backward compat) */
  contextBlocks: unknown[];
}

// ─── AgentOrchestrator: Pipeline-wide status summary ──────

export interface AgentPipelineStatus {
  allPassed: boolean;
  partialCount: number;
  failedCount: number;
  totalDurationMs: number;
  errors: string[];
}
