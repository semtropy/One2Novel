/**
 * AI Invocation — unified seam for all LLM calls.
 *
 * This module provides two entry points:
 *   - aiInvoke()     — for services that build their own userPrompt
 *   - invokeAsset()  — for chapter generation with context block selection
 *
 * All AI calls MUST go through aiInvoke() with a registered assetId.
 * Inline systemPrompt strings are no longer accepted.
 *
 * The AIService interface (below) exists solely for testing.
 * In production, getAIService() returns realAIService which delegates
 * to aiInvoke/invokeAsset. Replace with createMockAIService() in tests.
 */
import type { z, ZodType } from "zod";
import { invokeStructuredLlm } from "./structuredInvoke";
import type { LLMProvider } from "./provider";
import { generateFormatHint } from "./schemaFormatHint";
import { selectContextBlocks } from "./contextSelection";
import { renderSelectedContextBlocks } from "./renderContextBlocks";
import { injectSkillRules } from "./skillRules";
import type { PromptContextBlock } from "./promptTypes";
import { PROVIDER_REGISTRY } from "../config/providers";
import { DEFAULT_MODEL_CONTEXT_WINDOW, CONTEXT_SELECTION_BUDGET_FRACTION } from "../config/constants";

// ═══════════════════════════════════════════════════════════
// Preferred Provider
// ═══════════════════════════════════════════════════════════

/** Compute the default token budget for context selection. Uses model context window * 0.7. */
function getDefaultTokenBudget(): number {
  return Math.floor(DEFAULT_MODEL_CONTEXT_WINDOW * CONTEXT_SELECTION_BUDGET_FRACTION);
}

function loadPreferencesModule() {
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

export type TaskType = "writer" | "reviewer" | "planner" | "extractor" | "compiler" | "repairer";

export interface ContextRequirement {
  group: string;
  required?: boolean;
  priority: number;
}

export interface PromptAssetDef {
  id: string;
  taskType: TaskType;
  version: string;
  systemPrompt: string | ((vars?: Record<string, string>) => string);
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

function resolveSystemPrompt(asset: PromptAssetDef, vars?: Record<string, string>): string {
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

export function getTaskDefaults(taskType: TaskType): { temperature: number; maxTokens: number } {
  return { ...TASK_MODEL[taskType] };
}

export function resolvePrompt(assetId: string, vars?: Record<string, string>): string {
  const asset = promptRegistry.get(assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${assetId}`);
  return resolveSystemPrompt(asset, vars);
}

// ═══════════════════════════════════════════════════════════
// Unified AI Invocation
// ═══════════════════════════════════════════════════════════

export async function aiInvoke<T extends ZodType>(opts: {
  assetId: string;
  userPrompt: string;
  schema: T;
  templateVars?: Record<string, string>;
  skillModules?: string[];
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  novelId?: string;
  chapterId?: string;
}) {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);

  const route = TASK_MODEL[asset.taskType];
  const formatHint = generateFormatHint(opts.schema);
  let rawSystemPrompt = resolveSystemPrompt(asset, opts.templateVars);

  if (opts.skillModules && opts.skillModules.length > 0) {
    rawSystemPrompt = injectSkillRules(rawSystemPrompt, opts.skillModules);
  }

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

export async function invokeAsset<T extends ZodType>(opts: {
  assetId: string;
  blocks: PromptContextBlock[];
  schema: T;
  temperature?: number;
  maxTokens?: number;
  currentChapterOrder?: number;
}): Promise<{
  output: z.output<T>;
  trace: { selected: string[]; dropped: string[]; summarized: string[]; tokens: number };
}> {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);
  if (!asset.contextPolicy) throw new Error(`Asset ${opts.assetId} has no contextPolicy`);

  const selection = selectContextBlocks(opts.blocks, { maxTokens: getDefaultTokenBudget() }, opts.currentChapterOrder);
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
      summarized: selection.summarizedBlockIds,
      tokens: selection.estimatedTokens,
    },
  };
}

export function compileAsset(opts: {
  assetId: string;
  blocks: PromptContextBlock[];
  currentChapterOrder?: number;
}): { systemPrompt: string; userPrompt: string; trace: { selected: string[]; dropped: string[]; summarized: string[]; tokens: number } } {
  const asset = promptRegistry.get(opts.assetId);
  if (!asset) throw new Error(`Prompt asset not found: ${opts.assetId}`);
  if (!asset.contextPolicy) throw new Error(`Asset ${opts.assetId} has no contextPolicy`);

  const selection = selectContextBlocks(opts.blocks, { maxTokens: getDefaultTokenBudget() }, opts.currentChapterOrder);
  const userPrompt = renderSelectedContextBlocks(selection.selectedBlocks);

  return {
    systemPrompt: resolveSystemPrompt(asset, undefined),
    userPrompt,
    trace: {
      selected: selection.selectedBlocks.map((b) => b.id),
      dropped: selection.droppedBlockIds,
      summarized: selection.summarizedBlockIds,
      tokens: selection.estimatedTokens,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// AIService Interface — for testing only
// ═══════════════════════════════════════════════════════════

export interface AIInvokeParams<T = unknown> {
  assetId: string;
  userPrompt: string;
  schema: ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  novelId?: string;
}

export interface AIInvokeWithBlocksParams<T = unknown> {
  assetId: string;
  blocks: PromptContextBlock[];
  schema: ZodType<T>;
  temperature?: number;
  novelId?: string;
}

export interface AIService {
  invoke<T>(params: AIInvokeParams<T>): Promise<T>;
  invokeWithBlocks<T>(params: AIInvokeWithBlocksParams<T>): Promise<T>;
}

const realAIService: AIService = {
  async invoke<T>(params: AIInvokeParams<T>): Promise<T> {
    return aiInvoke({
      assetId: params.assetId,
      userPrompt: params.userPrompt,
      schema: params.schema,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      novelId: params.novelId,
    });
  },
  async invokeWithBlocks<T>(params: AIInvokeWithBlocksParams<T>): Promise<T> {
    const result = await invokeAsset({
      assetId: params.assetId,
      blocks: params.blocks,
      schema: params.schema,
      temperature: params.temperature,
    });
    return result.output;
  },
};

export function createMockAIService(responses: Record<string, unknown> = {}): AIService {
  return {
    async invoke<T>(params: AIInvokeParams<T>): Promise<T> {
      const key = params.assetId;
      if (key in responses) return responses[key] as T;
      throw new Error(`MockAIService: no response configured for assetId "${key}"`);
    },
    async invokeWithBlocks<T>(params: AIInvokeWithBlocksParams<T>): Promise<T> {
      const key = params.assetId;
      if (key in responses) return responses[key] as T;
      throw new Error(`MockAIService: no response configured for assetId "${key}"`);
    },
  };
}

let _defaultService: AIService = realAIService;

export function getAIService(): AIService {
  return _defaultService;
}

export function setAIService(service: AIService): void {
  _defaultService = service;
}
