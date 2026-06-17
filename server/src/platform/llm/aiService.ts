import type { z } from "zod";
import { invokeStructuredLlm } from "./structuredInvoke";
import type { LLMProvider } from "./provider";
import { generateFormatHint } from "./schemaFormatHint";
import { selectContextBlocks } from "./contextSelection";
import { renderSelectedContextBlocks } from "./renderContextBlocks";
import { injectSkillRules } from "./skillRules";
import { estimateTokens } from "./tokenCounter";
import { logEventError } from "../logging/eventErrorLog";
import type { PromptContextBlock } from "./promptTypes";

export type TaskType = "writer" | "reviewer" | "planner" | "extractor" | "compiler" | "repairer";

// ═══════════════════════════════════════════════════════════
// Preferred Provider
// ═══════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-require-imports
function loadPreferencesModule() {
  // tsc compiles to CommonJS where require() is natively available
  return require("../../modules/settings/preferences") as {
    getPreferences: () => { defaultProvider?: string; [key: string]: unknown };
  };
}

export function getPreferredProvider(): LLMProvider {
  try {
    const { getPreferences } = loadPreferencesModule();
    const raw = getPreferences().defaultProvider ?? "deepseek";
    return (raw.includes(":") ? raw.split(":")[0] : raw) as LLMProvider;
  } catch { return "deepseek"; }
}

export function getPreferredModel(): string | undefined {
  try {
    const { getPreferences } = loadPreferencesModule();
    const raw = getPreferences().defaultProvider ?? "";
    const parts = raw.split(":");
    return parts.length > 1 ? parts.slice(1).join(":") : undefined;
  } catch { return undefined; }
}

// ═══════════════════════════════════════════════════════════
// Prompt Registry
// ═══════════════════════════════════════════════════════════

export interface ContextRequirement {
  group: string;
  required?: boolean;
  priority: number;
}

export interface PromptAssetDef {
  id: string;
  taskType: TaskType;
  version: string;
  /** Static string or template function receiving runtime vars */
  systemPrompt: string | ((vars?: Record<string, string>) => string);
  /** Context blocks — used only by invokeAsset / compileAsset */
  contextRequirements?: ContextRequirement[];
  contextPolicy?: {
    maxTokensBudget?: number;
    requiredGroups?: string[];
    preferredGroups?: string[];
    dropOrder?: string[];
  };
}

const prompts = new Map<string, PromptAssetDef>();

export const promptRegistry = {
  register(def: PromptAssetDef) {
    prompts.set(def.id, def);
  },
  get(id: string): PromptAssetDef | undefined {
    return prompts.get(id);
  },
  getByTask(task: TaskType): PromptAssetDef[] {
    return [...prompts.values()].filter((p) => p.taskType === task);
  },
};

function resolveSystemPrompt(
  asset: PromptAssetDef,
  vars?: Record<string, string>,
): string {
  if (typeof asset.systemPrompt === "function") {
    return asset.systemPrompt(vars);
  }
  return asset.systemPrompt;
}

// ═══════════════════════════════════════════════════════════
// Model Router
// ═══════════════════════════════════════════════════════════

const TASK_MODEL: Record<TaskType, { temperature: number; maxTokens: number }> = {
  writer:    { temperature: 0.85, maxTokens: 8192 },
  reviewer:  { temperature: 0.3,  maxTokens: 2048 },
  planner:   { temperature: 0.8,  maxTokens: 8192 },
  extractor: { temperature: 0.5,  maxTokens: 4096 },
  compiler:  { temperature: 0.3,  maxTokens: 2048 },
  repairer:  { temperature: 0.5,  maxTokens: 8192 },
};


// ═══════════════════════════════════════════════════════════
// Prompt Asset Registration
// ═══════════════════════════════════════════════════════════

// All prompts registered in domain-owned files under modules/novel/prompts/
// Barrel is imported in app.ts (after aiService.ts is fully initialized) to avoid ESM hoisting circular deps.

/**
 * Resolve a prompt from the registry to a plain systemPrompt string.
 * For callers that bypass aiInvoke (e.g. direct llm.invoke / llm.stream).
 */
export function resolvePrompt(assetId: string, vars?: Record<string, string>): string {
  const asset = promptRegistry.get(assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${assetId}`);
  return resolveSystemPrompt(asset, vars);
}

// ═══════════════════════════════════════════════════════════
// Unified AI Invocation
// ═══════════════════════════════════════════════════════════

/**
 * Invoke LLM via registered prompt asset.
 *
 * All LLM calls MUST go through this function with a registered assetId.
 * Inline systemPrompt strings are no longer accepted — every prompt lives in
 * the promptRegistry above, giving a single place to audit, version, and tune.
 */
export async function aiInvoke<T extends z.ZodType>(opts: {
  /** Registered prompt asset ID */
  assetId: string;
  /** User prompt (the dynamic part — chapter content, character list, etc.) */
  userPrompt: string;
  /** Zod schema for structured output */
  schema: T;
  /** Runtime template vars for prompts with dynamic sections */
  templateVars?: Record<string, string>;
  /** Skill modules to inject after resolving the system prompt */
  skillModules?: string[];
  /** Override default temperature for this task type */
  temperature?: number;
  /** Override default maxTokens for this task type */
  maxTokens?: number;
  /** Max retries on validation failure */
  maxRetries?: number;
  /** Phase 5: Novel ID for cost tracking */
  novelId?: string;
  /** Phase 5: Chapter ID for cost tracking */
  chapterId?: string;
}) {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);

  const route = TASK_MODEL[asset.taskType];
  const formatHint = generateFormatHint(opts.schema);
  let rawSystemPrompt = resolveSystemPrompt(asset, opts.templateVars);

  // Apply skill rules if provided (post-registry injection)
  if (opts.skillModules && opts.skillModules.length > 0) {
    rawSystemPrompt = injectSkillRules(rawSystemPrompt, opts.skillModules);
  }

  // Prepend format constraints at the TOP so the LLM sees them first
  const systemPrompt = formatHint
    ? formatHint + "\n\n---\n\n" + rawSystemPrompt
    : rawSystemPrompt;

  const { result, usage } = await invokeStructuredLlm({
    provider: getPreferredProvider(),
    model: getPreferredModel(),
    temperature: opts.temperature ?? route.temperature,
    maxTokens: opts.maxTokens ?? route.maxTokens,
    maxRetries: opts.maxRetries,
    systemPrompt,
    userPrompt: opts.userPrompt,
    schema: opts.schema,
  });

  return result;
}

// ═══════════════════════════════════════════════════════════
// Asset-based Invocation (with context block selection)
// ═══════════════════════════════════════════════════════════

/**
 * Invoke a registered prompt asset with context blocks.
 * The asset's contextPolicy drives block selection, and its systemPrompt
 * is used verbatim. Returns the structured output + a trace of which blocks
 * were selected, dropped, or summarized.
 */
export async function invokeAsset<T extends z.ZodType>(opts: {
  assetId: string;
  blocks: PromptContextBlock[];
  schema: T;
  temperature?: number;
  maxTokens?: number;
}): Promise<{
  output: z.infer<T>;
  trace: { selected: string[]; dropped: string[]; summarized: string[]; tokens: number };
}> {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);
  if (!asset.contextPolicy) throw new Error(`Asset ${opts.assetId} has no contextPolicy`);

  const selection = selectContextBlocks(opts.blocks);
  const userPrompt = renderSelectedContextBlocks(selection.selectedBlocks);

  const route = TASK_MODEL[asset.taskType];
  const formatHint = generateFormatHint(opts.schema);
  const rawSystemPrompt = resolveSystemPrompt(asset, undefined);
  const systemPrompt = formatHint
    ? formatHint + "\n\n---\n\n" + rawSystemPrompt
    : rawSystemPrompt;

  const { result: output } = await invokeStructuredLlm({
    provider: getPreferredProvider(),
    model: getPreferredModel(),
    temperature: opts.temperature ?? route.temperature,
    maxTokens: opts.maxTokens ?? route.maxTokens,
    systemPrompt,
    userPrompt,
    schema: opts.schema,
  });

  return {
    output,
    trace: {
      selected: selection.selectedBlocks.map((b) => b.id),
      dropped: selection.droppedBlockIds,
      summarized: [],
      tokens: selection.estimatedTokens,
    },
  };
}

// Token estimation is imported from ./tokenCounter — single source of truth

/**
 * Compile a prompt asset into { systemPrompt, userPrompt } for streaming.
 * Streaming-only: does NOT call the LLM. For structured (non-streaming) calls,
 * use aiInvoke() or invokeAsset() which go through invokeStructuredLlm().
 */
export function compileAsset(opts: {
  assetId: string;
  blocks: PromptContextBlock[];
}): { systemPrompt: string; userPrompt: string; trace: { selected: string[]; dropped: string[]; summarized: string[]; tokens: number } } {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);
  if (!asset.contextPolicy) throw new Error(`Asset ${opts.assetId} has no contextPolicy`);

  const selection = selectContextBlocks(opts.blocks);
  const userPrompt = renderSelectedContextBlocks(selection.selectedBlocks);

  return {
    systemPrompt: resolveSystemPrompt(asset, undefined),
    userPrompt,
    trace: {
      selected: selection.selectedBlocks.map((b) => b.id),
      dropped: selection.droppedBlockIds,
      summarized: [],
      tokens: selection.estimatedTokens,
    },
  };
}
