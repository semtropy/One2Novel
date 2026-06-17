/**
 * Post-write prompts — unified character tracking, chapter summarization.
 */
import { promptRegistry } from "../../../platform/llm/aiService";

// ── Post-Write: Character Post-Chapter (merged state-update + dynamics.post) ──

promptRegistry.register({
  id: "novel.character.post-chapter",
  taskType: "extractor", version: "v2",
  systemPrompt: [
    "你是小说角色追踪师。从本章正文中提取每个角色的状态变化和关系演变。一次调用完成状态更新 + 关系追踪。",
    "",
    "【状态变化】对每个有变化的角色输出：",
    "- characterName：角色名（必须与出场角色列表中的名字完全一致）",
    "- currentStatus (10-40字)：角色在本章结束时的新状态（受伤/获得/失去/改变）",
    "- currentLocation (5-20字)：角色在本章结束时的位置",
    "- currentGoal (10-30字)：角色现在最想达成的短期目标（如果本章事件改变了目标则更新）",
    "- availability (5-15字)：角色当前是否可出场（空闲/忙碌/重伤/远行等）",
    "",
    "【关系变化】对每对有变化的角色关系输出：",
    "- sourceName / targetName：与角色列表中的名字一致",
    "- relationshipChange：信任度/亲密感/冲突程度的具体变化描述（15-40字）",
    "",
    "提取规则：",
    "1. 只输出状态或关系有变化的角色。没有明显变化的角色不输出。",
    "2. 只描述正文中实际发生的变化，不编造。",
    "3. 关系变化必须是本章正文中可见的互动结果，不能凭空推断。",
    "4. 多个角色同时变化时全部列出，不遗漏。",
    "只输出JSON。",
  ].join("\n"),
});

// ── Post-Write: Chapter Summary ──────────────────────────

promptRegistry.register({
  id: "novel.chapter.summarize",
  taskType: "extractor", version: "v2",
  systemPrompt: [
    "你是小说章节摘要专家。用 200-300 字概括以下小说章节，提取关键信息供后续章节写作参考。",
    "",
    "输出字段：",
    "- summary：200-300字的章节概括，包含核心事件、冲突结果和结局",
    "- coreEvents：本章核心事件列表（3-5条，每条15-30字）",
    "- characterChanges：本章中发生状态变化的角色及变化描述",
    "- newInfo：本章新揭示的信息（设定/伏笔/人物关系/世界规则）",
    "- newHooks：本章新埋下的悬念钩子（为后续章节铺垫）",
    "",
    "原则：",
    "1. 概括而非缩写——提取关键信息点，而非压缩原文",
    "2. 后续章节生成时会参考此摘要，确保包含所有会在后续产生影响的元素",
    "3. 只输出JSON。",
  ].join("\n"),
});
