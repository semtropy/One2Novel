/**
 * Phase 1.2: contextSelection 纯函数单测
 * 验证: required块保留、conflictGroup去重、optional排序、预算裁剪
 *
 * Run: npx tsx --test tests/contextSelection.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

// Import pure functions from TS source (tsx handles .ts imports)
const { createContextBlock } = require("../src/platform/llm/contextBlockBudget");
const { selectContextBlocks } = require("../src/platform/llm/contextSelection");

describe("selectContextBlocks", () => {
  const policy = {
    maxTokensBudget: 1000,
    requiredGroups: ["mission"],
    preferredGroups: ["characters", "payoffs"],
    dropOrder: ["world_rules", "scene_plan"],
  };

  it("① required 块即使超预算也保留", () => {
    const blocks = [
      createContextBlock({ id: "mission", group: "mission", priority: 100, required: true,
        content: "A".repeat(2000), // ~500 tokens — way over budget
      }),
    ];
    const result = selectContextBlocks(blocks, policy);
    // Required blocks are always included even if over budget
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "mission");
  });

  it("① required 块可以被摘要以节省预算（长文本被压缩）", () => {
    // Create content that is clearly over budget — 500 characters at ~2 chars/token ≈ 250 tokens
    const longContent = "Header Line\n" + Array.from({ length: 500 }, (_, i) => `Very long line number ${i + 1} with lots of random text to make it span multiple tokens`).join("\n");
    const blocks = [
      createContextBlock({ id: "mission", group: "mission", priority: 100, required: true,
        content: longContent, allowSummary: true,
      }),
    ];
    // Very tight budget forces summarization
    const tightPolicy = { ...policy, maxTokensBudget: 10 };
    const result = selectContextBlocks(blocks, tightPolicy);
    assert.strictEqual(result.selectedBlocks.length, 1);
    // Should be summarized
    assert.strictEqual(result.summarizedBlockIds.length, 1);
    assert.strictEqual(result.summarizedBlockIds[0], "mission");
    assert.ok(result.selectedBlocks[0].content.includes("[context summarized]"));
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
    const result = selectContextBlocks(blocks, policy);
    // Higher freshness wins
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
    const result = selectContextBlocks(blocks, policy);
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "a");
    assert.ok(result.droppedBlockIds.includes("b"));
  });

  it("③ optional 块按 preferred→priority→dropOrder 排序填充", () => {
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
    // characters is in preferredGroups (higher priority) → first
    // payoffs is in preferredGroups (lower priority) → second
    // world_rules is in dropOrder (not preferred) → third (or dropped)
    const result = selectContextBlocks(blocks, policy);
    const ids = result.selectedBlocks.map(b => b.id);
    assert.ok(ids.indexOf("ch") < ids.indexOf("pay"), "characters(99, preferred) should be before payoffs(98, preferred)");
  });

  it("④ 超预算时 optional 块被丢弃，dropped 数组正确", () => {
    const blocks = [
      createContextBlock({ id: "mission", group: "mission", priority: 100, required: true,
        content: "Mission content (short)",
      }),
      createContextBlock({ id: "sp", group: "scene_plan", priority: 93,
        content: "A".repeat(4000), // Large block
      }),
    ];
    const tightPolicy = { ...policy, maxTokensBudget: 200 };
    const result = selectContextBlocks(blocks, tightPolicy);
    // mission stays (required), scene_plan dropped
    assert.strictEqual(result.selectedBlocks.length, 1);
    assert.strictEqual(result.selectedBlocks[0].id, "mission");
    assert.ok(result.droppedBlockIds.includes("sp"));
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
    const result = selectContextBlocks(blocks, policy);
    // Empty block should be filtered out
    const emptySelected = result.selectedBlocks.filter(b => b.id === "empty");
    assert.strictEqual(emptySelected.length, 0);
  });
});
