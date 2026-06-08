/**
 * Zod Schema Introspection Utilities
 *
 * SINGLE SOURCE OF TRUTH for accessing Zod internals (_def).
 * All code that needs to inspect Zod schema structure MUST use
 * these helpers — never access _def directly.
 *
 * Compatible with Zod v3 (typeName) and Zod v4 (type).
 */

// ─── Types ──────────────────────────────────────────────

export type ZodDefInner = {
  typeName?: unknown;
  innerType?: unknown;
  type?: unknown;
  element?: unknown;
  shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  options?: unknown[];
  checks?: unknown[];
};

// ─── Core Introspection ─────────────────────────────────

/** Resolve shape from a Zod def, compatible with v3 (getter function) and v4 (plain object). */
export function safeShape(def: ZodDefInner | undefined): Record<string, unknown> | null {
  if (!def?.shape) return null;
  return typeof def.shape === "function" ? def.shape() : (def.shape as Record<string, unknown>);
}

/**
 * Unwrap Zod wrapper types (Optional, Default, Nullable, Effects, etc.)
 * returning the innermost concrete schema and whether any optional wrapper was present.
 */
export function unwrapSchema(s: unknown): { schema: unknown; optional: boolean } {
  let schema = s;
  let optional = false;
  while (true) {
    const d = (schema as { _def?: ZodDefInner })?._def;
    if (!d) break;
    // Zod v3 uses "typeName" ("ZodOptional"), Zod v4 uses "type" ("optional")
    const raw = d.typeName ?? d.type;
    const name = raw ? String(raw).replace(/^Zod/i, "").toLowerCase() : "";
    if (name === "optional" || name === "default") {
      optional = true;
      if (d.innerType) { schema = d.innerType; continue; }
    }
    if (name === "nullable" || name === "effects" || name === "readonly" || name === "branded" || name === "pipeline") {
      if (d.innerType) { schema = d.innerType; continue; }
    }
    break;
  }
  return { schema, optional };
}

/**
 * Return the normalized type name of a schema.
 * Unwraps wrapper types first.
 * Returns lowercase short name: "object", "string", "number", "array", etc.
 */
export function schemaTypeName(s: unknown): string {
  const { schema } = unwrapSchema(s);
  const d = (schema as { _def?: ZodDefInner })?._def;
  if (!d) return "";
  const raw = d.typeName ?? d.type;
  if (!raw) return "";
  return String(raw).replace(/^Zod/i, "").toLowerCase();
}

/**
 * Get the element type of a ZodArray, compatible with v3 (_def.type) and v4 (_def.element).
 * Returns the ZodType for array elements, or undefined if not an array.
 */
export function getArrayElement(schema: unknown): unknown {
  const { schema: inner } = unwrapSchema(schema);
  const def = (inner as { _def?: ZodDefInner })?._def;
  if (!def) return undefined;
  // v4: element schema in _def.element, v3: in _def.type
  return def.element ?? def.type;
}

// ─── Type Label (Chinese) ───────────────────────────────

/**
 * Generate a human-readable Chinese label for a schema type.
 * Accepts an already-unwrapped schema.
 */
export function typeLabelOf(schema: unknown): string {
  const d = (schema as { _def?: ZodDefInner })?._def;
  const raw = d?.typeName ?? d?.type;
  const tname = raw ? String(raw).replace(/^Zod/i, "").toLowerCase() : "";

  switch (tname) {
    case "string":  return "<字符串>";
    case "number":  return "<数字>";
    case "boolean": return "<布尔值>";
    case "array": {
      const itemType = getArrayElement(schema);
      const itemLabel = itemType ? typeLabelOf(itemType) : "<any>";
      return `<${itemLabel}数组>`;
    }
    case "enum": {
      const values = (d as { values?: readonly string[] })?.values ?? [];
      return `<${values.map((v: string) => `"${v}"`).join(" | ")}>`;
    }
    case "literal":
      return `<${JSON.stringify((d as { value?: unknown })?.value)}>`;
    case "object":
      return "<对象>";
    case "union": {
      const options = d?.options ?? [];
      return options.map((o: unknown) => typeLabelOf(o)).join(" 或 ");
    }
    case "record":
      return "<键值对>";
    default:
      return "<any>";
  }
}
