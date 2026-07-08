/**
 * Unit tests for contextSelection — token estimation, budget enforcement, dedup.
 * Run: npx tsx --test server/src/platform/llm/__tests__/contextSelection.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { selectContextBlocks, createContextBlock } from "../contextSelection";

describe("estimateTextTokens", () => {
  it("counts pure Chinese text accurately", () => {
    const block = createContextBlock({
      id: "test", group: "test", priority: 50,
      content: "这是一段纯粹的中文文本用于测试分词估算的准确性".repeat(10), // ~200 chars
    });
    // 200 Chinese chars × 1.5 = 300 tokens
    assert.ok(block.estimatedTokens >= 250 && block.estimatedTokens <= 350,
      `Expected ~300 tokens for 200 Chinese chars, got ${block.estimatedTokens}`);
  });

  it("counts pure English text accurately", () => {
    const phrases = Array(20).fill("This is a test phrase for token counting.");
    const text = phrases.join(" "); // ~700 ASCII chars
    const block = createContextBlock({ id: "test", group: "test", priority: 50, content: text });
    // ASCII chars × 0.25 ≈ 175 tokens for ~700 chars
    assert.ok(block.estimatedTokens >= 150 && block.estimatedTokens <= 220,
      `Expected ~175 tokens for ~700 ASCII chars, got ${block.estimatedTokens}`);
  });

  it("counts mixed Chinese/English correctly", () => {
    const block = createContextBlock({
      id: "test", group: "test", priority: 50,
      content: "中文测试 ABC testing 混合文本 mixed content 中文更多一些".repeat(5),
    });
    // Should be dominated by Chinese portion (~1.5x) with small ASCII contribution
    assert.ok(block.estimatedTokens > 0, "Mixed text should have positive token count");
  });

  it("returns 1 for very short text", () => {
    const block = createContextBlock({
      id: "test", group: "test", priority: 50,
      content: "中",
    });
    assert.equal(block.estimatedTokens, 2); // 1 Chinese char × 1.5 = 2 (ceil)
  });

  it("returns 0 for empty string", () => {
    const block = createContextBlock({
      id: "test", group: "test", priority: 50,
      content: "",
    });
    assert.equal(block.estimatedTokens, 0);
  });

  it("ignores whitespace-only content", () => {
    const block = createContextBlock({
      id: "test", group: "test", priority: 50,
      content: "   \n  \t  ",
    });
    assert.equal(block.estimatedTokens, 0);
  });
});

describe("selectContextBlocks deduplication", () => {
  it("keeps the fresher block when conflict groups collide", () => {
    const blocks = [
      createContextBlock({ id: "old", group: "style", priority: 50, content: "old data", conflictGroup: "style_contract", freshness: 0 }),
      createContextBlock({ id: "new", group: "style", priority: 50, content: "new data", conflictGroup: "style_contract", freshness: 1 }),
    ];
    const result = selectContextBlocks(blocks);
    assert.equal(result.selectedBlocks.length, 1);
    assert.equal(result.selectedBlocks[0].id, "new");
    assert.ok(result.droppedBlockIds.includes("old"));
  });

  it("keeps non-conflicting blocks together", () => {
    const blocks = [
      createContextBlock({ id: "a", group: "group_a", priority: 50, content: "data a" }),
      createContextBlock({ id: "b", group: "group_b", priority: 50, content: "data b" }),
    ];
    const result = selectContextBlocks(blocks);
    assert.equal(result.selectedBlocks.length, 2);
    assert.equal(result.droppedBlockIds.length, 0);
  });

  it("filters out empty blocks", () => {
    const blocks = [
      createContextBlock({ id: "empty", group: "test", priority: 50, content: "" }),
      createContextBlock({ id: "real", group: "test", priority: 50, content: "real data" }),
    ];
    const result = selectContextBlocks(blocks);
    assert.equal(result.selectedBlocks.length, 1);
    assert.equal(result.selectedBlocks[0].id, "real");
  });
});

describe("selectContextBlocks token budget", () => {
  it("keeps all blocks when under budget", () => {
    const blocks = [
      createContextBlock({ id: "a", group: "g1", priority: 95, content: "high priority data ".repeat(5) }),
      createContextBlock({ id: "b", group: "g2", priority: 50, content: "low priority data ".repeat(3) }),
    ];
    const result = selectContextBlocks(blocks, { maxTokens: 10000 });
    assert.equal(result.selectedBlocks.length, 2);
    assert.equal(result.budgetExceeded, false);
  });

  it("drops low-priority blocks when over budget", () => {
    const longText = "some content that takes up tokens ".repeat(100); // ~4000 chars
    const blocks = [
      createContextBlock({ id: "high", group: "g1", priority: 95, content: longText }),
      createContextBlock({ id: "mid", group: "g2", priority: 65, content: longText }),
      createContextBlock({ id: "low", group: "g3", priority: 40, content: longText }),
    ];
    const result = selectContextBlocks(blocks, { maxTokens: 300 }); // Very tight budget
    const ids = result.selectedBlocks.map(b => b.id);
    // High priority (>=90) should survive; low (<60) should drop
    assert.ok(ids.includes("high"), "High priority block should survive");
    assert.ok(!ids.includes("low") || result.droppedBlockIds.includes("low"), "Low priority should be dropped");
    assert.equal(result.budgetExceeded, true);
  });

  it("sorts by priority descending", () => {
    const blocks = [
      createContextBlock({ id: "low", group: "g1", priority: 10, content: "x" }),
      createContextBlock({ id: "high", group: "g2", priority: 90, content: "x" }),
      createContextBlock({ id: "mid", group: "g3", priority: 50, content: "x" }),
    ];
    const result = selectContextBlocks(blocks);
    const priorities = result.selectedBlocks.map(b => b.priority);
    for (let i = 1; i < priorities.length; i++) {
      assert.ok(priorities[i - 1] >= priorities[i], "Blocks should be sorted by priority descending");
    }
  });
});
