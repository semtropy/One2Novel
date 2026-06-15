import type { z } from "zod";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { createLLM, type LLMProvider } from "./provider";
import { relaxGeneratedContentSchema } from "./generatedContentSchema";
import {
  safeShape,
  unwrapSchema,
  schemaTypeName,
  getArrayElement,
  type ZodDefInner,
} from "./zodIntrospect";

// ─── Usage Extraction ──────────────────────────────────────

/**
 * Extract actual token usage from a LangChain AIMessage response.
 * Different providers store usage in different metadata locations.
 */
function extractUsage(response: AIMessage): { inputTokens: number; outputTokens: number } {
  const meta = response.response_metadata as Record<string, unknown>;
  // DeepSeek / OpenAI style
  if (meta?.tokenUsage) {
    const tu = meta.tokenUsage as Record<string, number>;
    return {
      inputTokens: tu.inputTokens ?? tu.prompt_tokens ?? 0,
      outputTokens: tu.outputTokens ?? tu.completion_tokens ?? 0,
    };
  }
  // Anthropic style
  if (meta?.usage) {
    const u = meta.usage as Record<string, number>;
    return {
      inputTokens: (u.input_tokens ?? u.inputTokens ?? 0),
      outputTokens: (u.output_tokens ?? u.outputTokens ?? 0),
    };
  }
  // Fallback: estimate from content length (rough, but better than nothing)
  const contentLen = typeof response.content === "string" ? response.content.length : 0;
  return { inputTokens: 0, outputTokens: Math.ceil(contentLen / 2) };
}

export interface StructuredInvokeResult<T extends z.ZodType> {
  result: z.output<T>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface StructuredInvokeOptions<T extends z.ZodType> {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  maxRetries?: number;
}

// ─── Phase 1.5: repairFieldNames ──────────────────────────

/** Keys that are metadata/categorization fields, NOT content. */
const METADATA_KEYS = new Set([
  "category", "title", "name", "id", "type", "status",
  "priority", "level", "rank", "order", "key", "tag", "label",
]);

/**
 * Recursively repair LLM field-name deviations in parsed JSON.
 * When the LLM uses an unrecognized key (e.g. "rule") instead of the
 * expected "content" key, recover the content before Zod strips it.
 */
function repairFieldNames(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) repairFieldNames(item);
    return;
  }
  const record = obj as Record<string, unknown>;
  // Recurse into all values first
  for (const v of Object.values(record)) repairFieldNames(v);
  // If this object has a `content` key set to undefined and extra string keys,
  // move the best-match extra string into `content`.
  if ("content" in record && record["content"] === undefined) {
    const extraStrKeys = Object.keys(record).filter(
      k => !METADATA_KEYS.has(k) && typeof record[k] === "string" && (record[k] as string).trim().length > 0
    );
    if (extraStrKeys.length > 0) {
      // Prefer the longest extra string value
      const bestKey = extraStrKeys.reduce((a, b) =>
        (record[b] as string).length > (record[a] as string).length ? b : a
      );
      record["content"] = record[bestKey];
      // If `title` also absent, derive from content
      if ("title" in record && record["title"] === undefined) {
        record["title"] = (record[bestKey] as string).slice(0, 15);
      }
    }
  }
}

// ─── Phase 1: normalizeJsonTypes ──────────────────────────

/** Recursively coerce JSON values to match schema-expected types.
 *  LLMs often output numbers as strings ("5" vs 5). This fixes it locally. */
function normalizeJsonTypes(parsed: unknown, schema: unknown): unknown {
  if (parsed === null || parsed === undefined) return parsed;

  const { schema: inner } = unwrapSchema(schema);
  const tname = schemaTypeName(schema);

  switch (tname) {
    case "number":
      if (typeof parsed === "string") { const n = Number(parsed); if (!isNaN(n)) return n; }
      return parsed;
    case "boolean":
      if (typeof parsed === "string") { if (parsed === "true") return true; if (parsed === "false") return false; }
      return parsed;
    case "string":
      if (typeof parsed === "number" || typeof parsed === "boolean") return String(parsed);
      return parsed;
    case "object": {
      if (typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
      const def = (inner as { _def?: ZodDefInner })?._def;
      const shapeObj = safeShape(def);
      if (!shapeObj) return parsed;
      const obj = parsed as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      const shapeKeys = Object.keys(shapeObj);
      for (const key of shapeKeys) {
        if (key in obj) {
          result[key] = normalizeJsonTypes(obj[key], shapeObj[key]);
        } else {
          result[key] = obj[key]; // keep undefined for Zod default/optional
        }
      }
      // Copy any extra keys the LLM added (Zod will strip them via .parse())
      for (const key of Object.keys(obj)) {
        if (!(key in result)) result[key] = obj[key];
      }
      return result;
    }
    case "array": {
      if (!Array.isArray(parsed)) return parsed;
      const elementType = getArrayElement(inner);
      if (!elementType) return parsed;
      return (parsed as unknown[]).map(item => normalizeJsonTypes(item, elementType));
    }
    case "union": {
      const options = (inner as { _def?: ZodDefInner })?._def?.options;
      if (!options) return parsed;
      // Try normalizing against each union option, return first that matches after normalization
      for (const opt of options) {
        const normalized = normalizeJsonTypes(parsed, opt);
        if (normalized !== parsed) return normalized; // was converted
      }
      return parsed;
    }
    default:
      return parsed;
  }
}

// ─── Phase 2: OP programmatic fixes ───────────────────────

/** Handle LLM output that is a bare array when schema expects a wrapping object.
 *  E.g. LLM outputs [{...}, {...}] but schema wants { rules: [{...}, {...}] }.
 *  Also handles single-element arrays that might be the inner object directly. */
function tryWrapRawArray<T>(parsed: unknown, schema: z.ZodType<T>): T | null {
  if (!Array.isArray(parsed)) return null;

  // Strategy 1: Single-element array — try unwrapping (original OP behavior)
  if (parsed.length === 1) {
    const inner = schema.safeParse(parsed[0]);
    if (inner.success) return inner.data;
  }

  // Strategy 2: Multi-element bare array — try wrapping into root object
  // Find the first array-typed key in the schema's root object shape
  const rootDef = getRootShapeDef(schema);
  if (!rootDef) return null;

  const arrayKeys: string[] = [];
  for (const [key, fieldSchema] of Object.entries(rootDef)) {
    if (schemaTypeName(fieldSchema as unknown) === "array") {
      arrayKeys.push(key);
    }
  }

  // Only auto-wrap when there's exactly one array key (unambiguous)
  if (arrayKeys.length !== 1) return null;

  const wrapped = { [arrayKeys[0]]: parsed };
  const result = schema.safeParse(wrapped);
  return result.success ? result.data : null;
}

/** Extract the shape definition from a ZodObject schema's root */
function getRootShapeDef(schema: unknown): Record<string, unknown> | null {
  const { schema: inner } = unwrapSchema(schema);
  if (schemaTypeName(schema) !== "object") return null;
  return safeShape((inner as { _def?: ZodDefInner })?._def);
}

/** OP migration: trim arrays that exceed schema max length */
function normalizeOversizedArrays<T>(parsed: unknown, error: z.ZodError, schema: z.ZodType<T>): { data: T } | null {
  const oversized = error.issues.filter(i => i.code === "too_big" && i.message.toLowerCase().includes("array"));
  if (oversized.length === 0) return null;

  let fixed: unknown = JSON.parse(JSON.stringify(parsed));
  for (const issue of oversized) {
    // Navigate to the oversized array and trim it
    if (issue.path.length === 0) {
      const max = (issue as { maximum?: number }).maximum;
      if (max !== undefined && Array.isArray(fixed)) fixed = fixed.slice(0, max);
    } else {
      fixed = setAtPath(fixed, issue.path as (string | number)[], (current: unknown) => {
        const max = (issue as { maximum?: number }).maximum;
        if (max !== undefined && Array.isArray(current)) return current.slice(0, max);
        return current;
      });
    }
  }

  const result = schema.safeParse(fixed);
  return result.success ? { data: result.data } : null;
}

function getAtPath(obj: unknown, path: (string | number)[]): unknown {
  let current = obj;
  for (const seg of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && typeof seg === "number") { current = current[seg]; continue; }
    if (typeof current === "object") { current = (current as Record<string, unknown>)[String(seg)]; continue; }
    return undefined;
  }
  return current;
}

function setAtPath(root: unknown, path: (string | number)[], fn: (value: unknown) => unknown): unknown {
  if (path.length === 0) return fn(root);
  const cloned: unknown = JSON.parse(JSON.stringify(root));
  const parentPath = path.slice(0, -1);
  const leaf = path[path.length - 1];
  const parent = getAtPath(cloned, parentPath);
  if (Array.isArray(parent) && typeof leaf === "number") {
    parent[leaf] = fn(parent[leaf]);
  } else if (parent && typeof parent === "object" && !Array.isArray(parent)) {
    (parent as Record<string, unknown>)[String(leaf)] = fn((parent as Record<string, unknown>)[String(leaf)]);
  }
  return cloned;
}

// ─── LLM Repair Prompt ─────────────────────────────────────

function buildRepairPrompt(lastError: string): string {
  let detail = lastError;
  try {
    const issues = JSON.parse(lastError);
    if (Array.isArray(issues) && issues.length > 0) {
      const lines = issues.slice(0, 5).map((i: { path: (string | number)[]; message: string }) => {
        const loc = i.path.length > 0 ? i.path.join(".") : "根对象";
        return `- ${loc}: ${i.message}`;
      });
      detail = lines.join("\n");
    }
  } catch { detail = lastError.slice(0, 500); }

  return [
    "你的上一次回复 JSON 格式校验失败。以下是具体问题：",
    detail,
    "",
    "请修正上述问题后重新输出完整的 JSON 对象。",
    "如果错误是 'expected number, received string'，把对应值改成纯数字（去掉引号）。",
    "如果错误是 'expected string, received number'，把对应值加上引号。",
    "只输出 JSON，不要 Markdown 代码块、解释或任何额外文本。",
    "确保所有必填字段都存在，键名与格式说明完全一致。",
  ].join("\n");
}

// ─── Main Invocation ───────────────────────────────────────

export async function invokeStructuredLlm<T extends z.ZodType>(
  opts: StructuredInvokeOptions<T>,
): Promise<StructuredInvokeResult<T>> {
  const provider = opts.provider ?? "deepseek";
  const maxRetries = opts.maxRetries ?? 3;
  const useJsonMode = provider === "deepseek" || provider === "openai";
  const llm = createLLM(provider, {
    model: opts.model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    responseFormat: useJsonMode ? "json_object" : undefined,
  });

  // Relax schema for LLM-generated content (remove string length checks)
  const runtimeSchema = relaxGeneratedContentSchema(opts.schema);

  const messages = [
    new SystemMessage(opts.systemPrompt),
    new HumanMessage(opts.userPrompt),
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const repairMessages = attempt > 0
        ? [...messages, new HumanMessage(buildRepairPrompt(lastError?.message ?? "Unknown format error"))]
        : messages;
      const response = await llm.invoke(repairMessages);

      // Extract actual token usage from provider response metadata
      const usage = extractUsage(response);

      const text = typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c: unknown) => (typeof c === "string" ? c : JSON.stringify(c))).join("")
          : "";

      // Extract JSON from response (handle markdown fences)
      let jsonText = text.trim();
      const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonText = fenceMatch[1].trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        // Try fixing truncated JSON
        jsonText = jsonText.replace(/,\s*$/g, "");
        const openB = (jsonText.match(/{/g) ?? []).length;
        const closeB = (jsonText.match(/}/g) ?? []).length;
        const openBr = (jsonText.match(/\[/g) ?? []).length;
        const closeBr = (jsonText.match(/]/g) ?? []).length;
        if (openBr > closeBr) jsonText += "]".repeat(openBr - closeBr);
        if (openB > closeB) jsonText += "}".repeat(openB - closeB);
        parsed = JSON.parse(jsonText);
      }

      // Phase 1: normalize types (numbers as strings → numbers, etc.)
      parsed = normalizeJsonTypes(parsed, opts.schema);

      // Phase 1.5: repair LLM field-name deviations.
      // LLMs often use semantically-correct field names (e.g. "rule") that don't
      // match the schema's expected key ("content"). Walk the parsed tree and
      // recover content from unrecognized string keys before Zod strips them.
      repairFieldNames(parsed);

      // Phase 2: OP programmatic fixes
      const wrapped = tryWrapRawArray(parsed, opts.schema);
      if (wrapped !== null) return { result: wrapped as z.output<T>, usage };

      // Try relaxed parse
      const first = runtimeSchema.safeParse(parsed);
      if (first.success) return { result: first.data, usage };

      // Try oversized array trim
      const trimmed = normalizeOversizedArrays(parsed, first.error, runtimeSchema);
      if (trimmed) return { result: trimmed.data as z.output<T>, usage };

      // If still failing, fall through to retry
      lastError = first.error;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("Structured LLM invocation failed");
}
