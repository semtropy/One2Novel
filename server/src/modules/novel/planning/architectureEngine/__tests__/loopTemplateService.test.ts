/**
 * Unit tests for loopTemplateService pure functions.
 * Run: npx tsx --test server/src/modules/novel/planning/architectureEngine/__tests__/loopTemplateService.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeLoopCount } from "../loopTemplateService";

describe("computeLoopCount", () => {
  it("returns 28 for 500 chapters with default architecture", () => {
    // 500 / 18 = 27.7 → 28
    assert.equal(computeLoopCount(500), 28);
  });

  it("returns minimum 5 for very short novels", () => {
    assert.equal(computeLoopCount(50), 5); // 50/18=2.7→3, clamped to 5
    assert.equal(computeLoopCount(90), 5); // 90/18=5, at boundary
  });

  it("uses default divisor 18 for any architecture", () => {
    // Architecture type no longer affects loop count — always 18
    assert.equal(computeLoopCount(500), 28); // 500/18=27.8→28
    assert.equal(computeLoopCount(360), 20); // 360/18=20
  });

  it("handles 1000-chapter epic", () => {
    assert.equal(computeLoopCount(1000), 56); // 1000/18=55.6→56
  });

  it("handles 2000-chapter mega-epic", () => {
    assert.equal(computeLoopCount(2000), 111); // 2000/18=111.1→111
  });
});
