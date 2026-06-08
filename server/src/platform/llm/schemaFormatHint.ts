/**
 * Generate a hard-constraint format block from a Zod schema.
 * Prepended (not appended) to every aiInvoke system prompt so the
 * LLM has zero ambiguity about the required JSON structure.
 *
 * Design principle: prompt authors never need to mention JSON keys or types.
 * This block is the single source of truth for output format.
 */

import {
  safeShape,
  unwrapSchema,
  schemaTypeName,
  getArrayElement,
  typeLabelOf,
  type ZodDefInner,
} from "./zodIntrospect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDef(schema: any): ZodDefInner | undefined {
  return (schema as { _def?: ZodDefInner })?._def;
}

// Local aliases — match the file's existing naming conventions
const unwrap = unwrapSchema;
const typeNameOf = schemaTypeName;

// ─── Public API ──────────────────────────────────────────

export function generateFormatHint(schema: any): string {
  const rootKeys = collectRootKeys(schema);
  if (rootKeys.length === 0) return "";

  const blocks: string[] = [];
  blocks.push("【输出硬约束 — 违反将导致解析失败】");
  blocks.push("你必须输出一个 JSON 对象，根对象直接包含以下键名（精确匹配，区分大小写）：");
  blocks.push("");

  for (const key of rootKeys) {
    blocks.push(`  "${key.key}": ${key.typeLabel}${key.required ? "（必填）" : "（可选）"}`);
  }
  blocks.push("");

  // Describe nested structures
  const nested = describeRootFields(schema);
  if (nested) {
    blocks.push(nested);
    blocks.push("");
  }

  blocks.push("绝对禁止：");
  blocks.push("1. 用额外键包装根对象（如 {\"result\": {...}} 或 {\"data\": {...}}）");
  blocks.push("2. 输出裸数组（如 [{...}] 代替 {\"key\": [{...}]}）");
  blocks.push("3. 将键名翻译或汉化（如 \"书名\" 代替 \"title\"）");
  blocks.push("4. 添加 Markdown 代码块（```json）或任何解释文字");
  blocks.push("5. 遗漏任何必填键");
  blocks.push("6. 使用上面未列出的键名（如用 \"rule\" 代替 \"content\"、用 \"name\" 代替 \"title\"）");

  return blocks.join("\n");
}

// ─── Internal helpers ────────────────────────────────────

interface RootKey {
  key: string;
  typeLabel: string;
  required: boolean;
}

function collectRootKeys(schema: any): RootKey[] {
  const unwrapped = unwrap(schema);
  const tname = typeNameOf(unwrapped.schema);

  if (tname !== "object") return [];

  const shapeDef = safeShape(getDef(unwrapped.schema));
  if (!shapeDef) return [];

  const keys: RootKey[] = [];
  for (const key of Object.keys(shapeDef)) {
    const fieldSchema = shapeDef[key];
    const { optional } = unwrap(fieldSchema);
    keys.push({
      key: String(key),  // ensure string — Zod v4 shape keys can be non-string in some edge cases
      typeLabel: typeLabelOf(unwrap(fieldSchema).schema),
      required: !optional,
    });
  }
  return keys;
}

function describeRootFields(schema: any): string {
  const unwrapped = unwrap(schema);
  const tname = typeNameOf(unwrapped.schema);
  if (tname !== "object") return "";

  const shapeDef = safeShape(getDef(unwrapped.schema));
  if (!shapeDef) return "";

  const lines: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shapeDef)) {
    const desc = describeField(key, fieldSchema);
    if (desc) lines.push(desc);
  }
  return lines.join("\n");
}

function describeField(key: string, schema: any): string {
  const { schema: inner } = unwrap(schema);
  const tname = typeNameOf(inner);

  if (tname === "array") {
    const itemType = getArrayElement(inner);
    if (itemType) {
      const itemTname = typeNameOf(itemType);
      if (itemTname === "object") {
        const itemShapeDef = safeShape(getDef(itemType));
        if (itemShapeDef) {
          const fields: string[] = [];
          for (const [fk, fv] of Object.entries(itemShapeDef)) {
            const { optional } = unwrap(fv);
            fields.push(`"${fk}": ${typeLabelOf(unwrap(fv).schema)}${optional ? "（可选）" : ""}`);
          }
          return `  "${key}" 数组中每个元素包含: { ${fields.join(", ")} }`;
        }
      }
    }
    return `  "${key}" 是数组，元素为: ${typeLabelOf(itemType)}`;
  }

  if (tname === "object") {
    const innerShapeDef = safeShape(getDef(inner));
    if (innerShapeDef) {
      const fields: string[] = [];
      for (const [fk, fv] of Object.entries(innerShapeDef)) {
        const { optional } = unwrap(fv);
        fields.push(`"${fk}": ${typeLabelOf(unwrap(fv).schema)}${optional ? "（可选）" : ""}`);
      }
      return `  "${key}" 对象包含: { ${fields.join(", ")} }`;
    }
  }

  return "";
}

// typeLabelOf is imported from zodIntrospect
