/**
 * Unit tests for computeCraftStats — dialogue detection and stats calculation.
 * Run: npx tsx --test server/src/modules/novel/planning/referenceDeepAnalysis/__tests__/craftStats.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeCraftStats } from "../modules";
import type { ChapterAnnotation } from "../index";

function makeAnnotation(overrides: Partial<ChapterAnnotation> = {}): ChapterAnnotation {
  return {
    chapterIndex: 1,
    chapterType: "advance",
    coolPointLevel: "high",
    hookType: "suspense",
    contentBeat: "修炼",
    conflictIntensity: 7,
    openingType: "action",
    summary: "test chapter",
    exemplarOpening: "主角推开沉重的铁门，『终于到了』他低声说。",
    exemplarEnding: "她回过头：「下次见面，我不会再手下留情。」",
    ...overrides,
  };
}

describe("computeCraftStats", () => {
  it("returns dominantOpening based on input annotations", () => {
    const annotations = [
      makeAnnotation({ chapterIndex: 1, openingType: "action" }),
      makeAnnotation({ chapterIndex: 2, openingType: "action" }),
      makeAnnotation({ chapterIndex: 3, openingType: "dialogue" }),
    ];
    const result = computeCraftStats(annotations);
    assert.equal(result.dominantOpening, "action");
    assert.equal(result.openingPatterns.action, 2);
    assert.equal(result.openingPatterns.dialogue, 1);
  });

  it("detects dialogue from Chinese quotation marks", () => {
    const annotations = [
      makeAnnotation({
        chapterIndex: 1,
        exemplarOpening: "『站住！』守卫大喊。「我没有恶意」主角平静地回答。『证明给我看』",
      }),
    ];
    const result = computeCraftStats(annotations);
    // Should detect 3 dialogue segments
    assert.ok(result.dialogueRatio > 0, "Should detect dialogue ratio > 0");
    assert.ok(result.avgDialoguePerChapter > 0, "Should have avg dialogue per chapter > 0");
  });

  it("handles annotations with no dialogue", () => {
    const annotations = [
      makeAnnotation({
        chapterIndex: 1,
        exemplarOpening: "远处的山脉在晨雾中若隐若现，主人公独自走在荒芜的古道上。",
        exemplarEnding: "夕阳西下，他回头望了一眼来路，继续向前走去。",
      }),
    ];
    const result = computeCraftStats(annotations);
    assert.equal(result.dialogueRatio, 0);
    assert.equal(result.avgDialoguePerChapter, 0);
  });

  it("handles empty annotations array", () => {
    const result = computeCraftStats([]);
    assert.equal(result.dominantOpening, "unknown");
    assert.equal(result.dialogueRatio, 0);
    assert.equal(result.avgDialoguePerChapter, 0);
  });

  it("handles annotations with missing exemplar fields", () => {
    const annotations = [
      { chapterIndex: 1, chapterType: "advance" as const, coolPointLevel: "high" as const,
        hookType: "suspense" as const, contentBeat: "修炼", conflictIntensity: 5,
        openingType: "environment" as const, summary: "no excerpts" },
    ];
    // Should not crash with missing exemplar fields
    assert.doesNotThrow(() => computeCraftStats(annotations as ChapterAnnotation[]));
  });
});
