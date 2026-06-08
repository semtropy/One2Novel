/**
 * Relax Zod schemas for LLM-generated content.
 * ADAPTED from OP: server/src/llm/generatedContentSchema.ts
 *
 * LLMs often output strings that are slightly too long/short, or numbers as strings.
 * This module recursively clones a Zod schema and removes strict constraints
 * (string length checks) so that Zod.parse() doesn't fail on minor formatting issues.
 */

import type { z } from "zod";

type AnySchema = z.ZodTypeAny;

type CloneableSchema = AnySchema & {
  clone: (definition?: Record<string, unknown>) => AnySchema;
  def?: Record<string, unknown>;
  _def?: Record<string, unknown>;
};

const STRING_LENGTH_CHECKS = new Set(["min_length", "max_length", "length_equals"]);
const relaxedSchemaCache = new WeakMap<AnySchema, AnySchema>();

function getSchemaDef(schema: AnySchema): Record<string, unknown> | null {
  const candidate = schema as CloneableSchema;
  return (candidate.def ?? candidate._def) as Record<string, unknown> | null;
}

function cloneSchema(schema: AnySchema, definition: Record<string, unknown>): AnySchema {
  return (schema as CloneableSchema).clone(definition);
}

function relaxStringSchema(schema: AnySchema, definition: Record<string, unknown>): AnySchema {
  const checks = Array.isArray(definition.checks) ? definition.checks : [];
  const nextChecks = checks.filter((item) => {
    const check = typeof item === "object" && item !== null
      ? ((item as { _zod?: { def?: { check?: unknown } } })._zod?.def?.check)
      : undefined;
    return typeof check !== "string" || !STRING_LENGTH_CHECKS.has(check);
  });
  if (nextChecks.length === checks.length) return schema;
  return cloneSchema(schema, { ...definition, checks: nextChecks });
}

function relaxGeneratedContentSchemaInternal(schema: AnySchema): AnySchema {
  const cached = relaxedSchemaCache.get(schema);
  if (cached) return cached;

  const definition = getSchemaDef(schema);
  if (!definition || typeof (schema as CloneableSchema).clone !== "function") return schema;

  const type = typeof definition.type === "string" ? definition.type : "";
  let relaxed = schema;

  switch (type) {
    case "string":
      relaxed = relaxStringSchema(schema, definition);
      break;
    case "object": {
      const shapeSource = typeof definition.shape === "function"
        ? (definition.shape as () => Record<string, AnySchema>)()
        : definition.shape as Record<string, AnySchema> | undefined;
      if (shapeSource) {
        const nextShape = Object.fromEntries(
          Object.entries(shapeSource).map(([key, value]) => [key, relaxGeneratedContentSchemaInternal(value)]),
        );
        relaxed = cloneSchema(schema, { ...definition, shape: nextShape });
      }
      break;
    }
    case "array":
      if (definition.element) {
        relaxed = cloneSchema(schema, { ...definition, element: relaxGeneratedContentSchemaInternal(definition.element as AnySchema) });
      }
      break;
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
      if (definition.innerType) {
        relaxed = cloneSchema(schema, { ...definition, innerType: relaxGeneratedContentSchemaInternal(definition.innerType as AnySchema) });
      }
      break;
    case "union":
      if (Array.isArray(definition.options)) {
        relaxed = cloneSchema(schema, { ...definition, options: (definition.options as AnySchema[]).map((item) => relaxGeneratedContentSchemaInternal(item)) });
      }
      break;
    default:
      relaxed = schema;
      break;
  }

  relaxedSchemaCache.set(schema, relaxed);
  return relaxed;
}

export function relaxGeneratedContentSchema<T extends z.ZodType>(schema: T): T {
  return relaxGeneratedContentSchemaInternal(schema as AnySchema) as unknown as T;
}
