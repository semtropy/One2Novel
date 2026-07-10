/**
 * Tests for qualityGate.ts — verdict logic, genre thresholds, prohibition scanning.
 *
 * Run: npx tsx --test server/src/modules/novel/production/quality/__tests__/qualityGate.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  totalQualityScore,
  passThreshold,
  genreDimensionLabels,
  type QualityResult,
} from "../qualityGate";

describe("totalQualityScore", () => {
  it("sums all 10 dimensions", () => {
    const result: QualityResult = {
      openingScore: 8, plotScore: 7, characterScore: 6, dialogueScore: 5,
      suspenseScore: 4, pacingScore: 3, showNotTellScore: 7, languageScore: 8,
      genreScore: 6, coherenceScore: 5, overallComment: "test", verdict: "PASS",
    };
    // 8+7+6+5+4+3+7+8+6+5 = 59
    assert.equal(totalQualityScore(result), 59);
  });

  it("returns 0 for all-zero scores", () => {
    const result: QualityResult = {
      openingScore: 0, plotScore: 0, characterScore: 0, dialogueScore: 0,
      suspenseScore: 0, pacingScore: 0, showNotTellScore: 0, languageScore: 0,
      genreScore: 0, coherenceScore: 0, overallComment: "test", verdict: "NEEDS_FIX",
    };
    assert.equal(totalQualityScore(result), 0);
  });

  it("returns 100 for all-max scores", () => {
    const result: QualityResult = {
      openingScore: 10, plotScore: 10, characterScore: 10, dialogueScore: 10,
      suspenseScore: 10, pacingScore: 10, showNotTellScore: 10, languageScore: 10,
      genreScore: 10, coherenceScore: 10, overallComment: "test", verdict: "PASS",
    };
    assert.equal(totalQualityScore(result), 100);
  });
});

describe("passThreshold", () => {
  it("returns 65 for 悬疑 genre", () => {
    assert.equal(passThreshold("悬疑"), 65);
  });

  it("returns 65 for 推理 genre", () => {
    assert.equal(passThreshold("推理"), 65);
  });

  it("returns 65 for 奇幻 genre", () => {
    assert.equal(passThreshold("奇幻"), 65);
  });

  it("returns 60 for other genres", () => {
    assert.equal(passThreshold("言情"), 60);
    assert.equal(passThreshold("科幻"), 60);
    assert.equal(passThreshold("武侠"), 60);
    assert.equal(passThreshold("都市"), 60);
  });

  it("returns 60 for null/undefined/empty genre", () => {
    assert.equal(passThreshold(null), 60);
    assert.equal(passThreshold(undefined), 60);
    assert.equal(passThreshold(""), 60);
  });
});

describe("genreDimensionLabels", () => {
  it("returns correct labels for 悬疑", () => {
    const labels = genreDimensionLabels("悬疑");
    assert.deepEqual(labels, ["线索布局", "谜题逻辑", "信息揭示", "误导设计"]);
  });

  it("returns correct labels for 言情", () => {
    const labels = genreDimensionLabels("言情");
    assert.deepEqual(labels, ["关系张力", "情感节奏", "CP反应", "冲突真实"]);
  });

  it("returns correct labels for 奇幻", () => {
    const labels = genreDimensionLabels("奇幻");
    assert.deepEqual(labels, ["世界观一致", "新奇感", "设定融入", "规则代价"]);
  });

  it("returns correct labels for 科幻", () => {
    const labels = genreDimensionLabels("科幻");
    assert.deepEqual(labels, ["世界观一致", "新奇感", "设定融入", "规则代价"]);
  });

  it("returns correct labels for 成长", () => {
    const labels = genreDimensionLabels("成长");
    assert.deepEqual(labels, ["成长可见", "挫折真实", "顿悟时刻"]);
  });

  it("returns correct labels for 动作", () => {
    const labels = genreDimensionLabels("动作");
    assert.deepEqual(labels, ["动作描写", "紧张递进", "后果意义"]);
  });

  it("returns correct labels for default", () => {
    const labels = genreDimensionLabels("未知题材");
    assert.deepEqual(labels, ["题材适配", "类型满足"]);
  });
});
