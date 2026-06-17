/**
 * contextSelection 纯函数单测
 * 验证: conflictGroup去重、空块过滤、优先级排序
 *
 * Run: npx tsx --test tests/contextSelection.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

const { selectContextBlocks, createContextBlock } = require("../src/platform/llm/contextSelection");

describe("selectContextBlocks", () => {
  it("① 所有有效块都被返回（无预算裁剪）", () => {
    const blocks = [
      createContextBlock({ id: "mission", group: "mission", priority: 100, required: true,
        content: "A".repeat(2000),
      }),
    ];
    const result = selectContextBlocks(blocks);
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "mission");
  });

  it("② conflictGroup 内按 freshness 去重——高 freshness 优先", () => {
    const blocks = [
      createContextBlock({ id: "char_snapshot", group: "characters", priority: 99, required: true,
        content: "Snapshot version (snapshot v1)", conflictGroup: "characters", freshness: 2,
      }),
      createContextBlock({ id: "char_live", group: "characters", priority: 98, required: false,
        content: "Live version (current DB)", conflictGroup: "characters", freshness: 1,
      }),
    ];
    const result = selectContextBlocks(blocks);
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "char_snapshot");
    assert.ok(result.droppedBlockIds.includes("char_live"));
  });

  it("② conflictGroup 同 freshness 时高 priority 获胜", () => {
    const blocks = [
      createContextBlock({ id: "a", group: "characters", priority: 99,
        content: "High priority content", conflictGroup: "g1",
      }),
      createContextBlock({ id: "b", group: "characters", priority: 80,
        content: "Low priority content", conflictGroup: "g1",
      }),
    ];
    const result = selectContextBlocks(blocks);
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "a");
    assert.ok(result.droppedBlockIds.includes("b"));
  });

  it("③ 多个非冲突块按 priority 降序排列", () => {
    const blocks = [
      createContextBlock({ id: "wr", group: "world_rules", priority: 90,
        content: "World rules content",
      }),
      createContextBlock({ id: "pay", group: "payoffs", priority: 98,
        content: "Payoff content",
      }),
      createContextBlock({ id: "ch", group: "characters", priority: 99,
        content: "Character content",
      }),
    ];
    const result = selectContextBlocks(blocks);
    // All three should be kept (no budget trimming)
    assert.strictEqual(result.selectedBlocks.length, 3);
    // Sorted by priority desc
    const ids = result.selectedBlocks.map(b => b.id);
    assert.strictEqual(ids[0], "ch");  // priority 99
    assert.strictEqual(ids[1], "pay"); // priority 98
    assert.strictEqual(ids[2], "wr");  // priority 90
  });

  it("④ 空内容块被过滤", () => {
    const blocks = [
      createContextBlock({ id: "mission", group: "mission", priority: 100, required: true,
        content: "Valid mission",
      }),
      createContextBlock({ id: "empty", group: "characters", priority: 50,
        content: "",
      }),
    ];
    const result = selectContextBlocks(blocks);
    const emptySelected = result.selectedBlocks.filter(b => b.id === "empty");
    assert.strictEqual(emptySelected.length, 0);
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "mission");
  });

  it("⑤ required 标记在 conflictGroup 去重时合并", () => {
    const blocks = [
      createContextBlock({ id: "old", group: "characters", priority: 80, required: true,
        content: "Old required content", conflictGroup: "g1", freshness: 1,
      }),
      createContextBlock({ id: "new", group: "characters", priority: 90, required: false,
        content: "New optional content", conflictGroup: "g1", freshness: 2,
      }),
    ];
    const result = selectContextBlocks(blocks);
    assert.strictEqual(result.selectedBlocks.length, 1);
    // new wins due to higher freshness, but required should be merged from old
    assert.strictEqual(result.selectedBlocks[0].id, "new");
    assert.strictEqual(result.selectedBlocks[0].required, true);
    assert.ok(result.droppedBlockIds.includes("old"));
  });
});
