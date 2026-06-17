/**
 * Pipeline State — tracking the 4-step creation pipeline progress.
 * Each step builds on the previous: foundation → architecture → characters → outline.
 * State is stored as JSON on the Novel record.
 */
import { getPrisma } from "../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export type StepName =
  | "foundation"   // Step 1: 创作起点 (story core + golden finger + commercial + world rules)
  | "architecture" // Step 2: 架构选择 (template + reference + loop phases + expectation profile)
  | "characters"   // Step 3: 角色阵容 (AI generation + relationship graph)
  | "outline";      // Step 4: 章节大纲 (loop skeleton → volume expansion → chapter detail)

export type StepStatus = "pending" | "generating" | "completed" | "skipped" | "error";

export interface StepState {
  status: StepStatus;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineState {
  novelId: string;
  mode: "fast" | "advanced";
  steps: Partial<Record<StepName, StepState>>;
  currentStep: StepName | null;
}

// ─── Default state ─────────────────────────────────────

export function createInitialPipelineState(
  novelId: string,
  mode: "fast" | "advanced" = "advanced",
): PipelineState {
  return {
    novelId,
    mode,
    steps: {
      foundation: { status: "pending" },
      architecture: { status: "pending" },
      characters: { status: "pending" },
      outline: { status: "pending" },
    },
    currentStep: "foundation",
  };
}

// ─── Persistence ────────────────────────────────────────

export async function getPipelineState(novelId: string): Promise<PipelineState | null> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { pipelineState: true },
  });
  if (!novel?.pipelineState) return null;
  try {
    return JSON.parse(novel.pipelineState) as PipelineState;
  } catch {
    return null;
  }
}

export async function savePipelineState(state: PipelineState): Promise<void> {
  const prisma = getPrisma();
  await prisma.novel.update({
    where: { id: state.novelId },
    data: { pipelineState: JSON.stringify(state) },
  });
}

export async function updateStepState(
  novelId: string,
  stepName: StepName,
  update: Partial<StepState>,
): Promise<PipelineState> {
  const state = (await getPipelineState(novelId)) ?? createInitialPipelineState(novelId);

  const existing = state.steps[stepName] ?? { status: "pending" as StepStatus };
  state.steps[stepName] = {
    ...existing,
    ...update,
  };

  if (update.status === "completed" || update.status === "error") {
    (state.steps[stepName]!).completedAt = new Date().toISOString();
  }
  if (update.status === "generating") {
    (state.steps[stepName]!).startedAt = new Date().toISOString();
  }

  await savePipelineState(state);
  return state;
}

/** Step order for serial execution: 1→2→3→4 */
const STEP_ORDER: StepName[] = ["foundation", "architecture", "characters", "outline"];

/**
 * Advance currentStep to the next pending step.
 * Returns the next step name or null if all steps are done.
 */
export async function advanceToNextStep(novelId: string): Promise<StepName | null> {
  const state = await getPipelineState(novelId);
  if (!state) return null;

  const currentIdx = state.currentStep ? STEP_ORDER.indexOf(state.currentStep) : -1;
  for (let i = currentIdx + 1; i < STEP_ORDER.length; i++) {
    const step = STEP_ORDER[i];
    const stepState = state.steps[step];
    if (stepState && stepState.status !== "completed" && stepState.status !== "skipped") {
      state.currentStep = step;
      await savePipelineState(state);
      return step;
    }
  }

  return null; // All steps done
}

/**
 * Check if all required steps are completed.
 */
export function isPipelineComplete(state: PipelineState): boolean {
  const requiredSteps: StepName[] = ["foundation", "architecture", "characters", "outline"];
  return requiredSteps.every(
    (s) =>
      state.steps[s]?.status === "completed" || state.steps[s]?.status === "skipped",
  );
}
