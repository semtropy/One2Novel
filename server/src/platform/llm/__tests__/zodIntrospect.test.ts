/**
 * Integration tests for zodIntrospect — ensures Zod v3/v4 compatibility
 * of shared schema introspection functions.
 *
 * Run: npx tsx --test server/src/platform/llm/__tests__/zodIntrospect.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { z } from "zod";
import {
  safeShape,
  unwrapSchema,
  schemaTypeName,
  getArrayElement,
  typeLabelOf,
} from "../zodIntrospect";

describe("schemaTypeName", () => {
  it("returns 'object' for z.object", () => {
    assert.equal(schemaTypeName(z.object({ a: z.string() })), "object");
  });

  it("returns 'string' for z.string (unwrapping optional)", () => {
    assert.equal(schemaTypeName(z.string().optional()), "string");
  });

  it("returns 'number' for z.number", () => {
    assert.equal(schemaTypeName(z.number()), "number");
  });

  it("returns 'array' for z.array", () => {
    assert.equal(schemaTypeName(z.array(z.string())), "array");
  });

  it("returns 'boolean' for z.boolean", () => {
    assert.equal(schemaTypeName(z.boolean()), "boolean");
  });
});

describe("unwrapSchema", () => {
  it("unwraps optional → optional=true, inner type is string", () => {
    const result = unwrapSchema(z.string().optional());
    assert.equal(result.optional, true);
    assert.equal(schemaTypeName(result.schema), "string");
  });

  it("unwraps optional().default() → optional=true, inner type is string", () => {
    const result = unwrapSchema(z.string().optional().default("x"));
    assert.equal(result.optional, true);
    assert.equal(schemaTypeName(result.schema), "string");
  });

  it("returns optional=false for plain z.string", () => {
    const result = unwrapSchema(z.string());
    assert.equal(result.optional, false);
    assert.equal(schemaTypeName(result.schema), "string");
  });
});

describe("safeShape", () => {
  it("returns shape keys for z.object", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const shape = safeShape(schema._def);
    assert.ok(shape !== null);
    assert.deepEqual(Object.keys(shape!), ["name", "age"]);
  });

  it("returns null for z.string (no shape)", () => {
    assert.equal(safeShape(z.string()._def), null);
  });
});

describe("getArrayElement", () => {
  it("returns the element type for z.array(z.string())", () => {
    const elem = getArrayElement(z.array(z.string()));
    assert.ok(elem !== undefined);
    assert.equal(schemaTypeName(elem), "string");
  });

  it("returns the element type for nested arrays", () => {
    const elem = getArrayElement(z.array(z.object({ x: z.number() })));
    assert.ok(elem !== undefined);
    assert.equal(schemaTypeName(elem), "object");
  });
});

describe("typeLabelOf", () => {
  it("returns <字符串> for z.string", () => {
    assert.equal(typeLabelOf(z.string()), "<字符串>");
  });

  it("returns <数字> for z.number", () => {
    assert.equal(typeLabelOf(z.number()), "<数字>");
  });

  it("returns <布尔值> for z.boolean", () => {
    assert.equal(typeLabelOf(z.boolean()), "<布尔值>");
  });

  it("returns <<字符串>数组> for z.array(z.string())", () => {
    assert.equal(typeLabelOf(z.array(z.string())), "<<字符串>数组>");
  });

  it("returns <对象> for z.object", () => {
    assert.equal(typeLabelOf(z.object({})), "<对象>");
  });
});
