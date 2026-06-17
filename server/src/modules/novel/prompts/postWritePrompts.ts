/**
 * Post-write prompts — character state updates, dynamics tracking, chapter summarization.
 */
import { promptRegistry } from "../../../platform/llm/aiService";

// ── Post-Write: Character State Update ───────────────────

promptRegistry.register({
  id: "novel.character.state-update",
  taskType: "extractor", version: "v1",
  systemPrompt: [
    "你是小说角色状态追踪员。从章节正文中提取每个角色的状态变化。",
    "",
    "提取规则：",
    "1. currentStatus (10-40字): 角色在本章结束时的新状态（受伤/获得/失去/改变）",
    "2. currentLocation (5-20字): 角色在本章结束时的位置",
    "3. currentGoal (10-30字): 角色现在最想达成的短期目标",
    "4. availability (5-15字): 角色当前是否可出场（空闲/忙碌/重伤/远行等）",
    "",
    "只输出状态有变化的角色。没有明显变化的角色不输出。",
    "只输出JSON。",
  ].join("\n"),
});

// ── Post-Write: Character Dynamics Update ────────────────

promptRegistry.register({
  id: "novel.character.dynamics.post",
  taskType: "extractor", version: "v1",
  systemPrompt: [
    "你是小说角色动态追踪分析师。根据最新章节内容，追踪角色状态变化和关系演变。",
    "分析维度：",
    "1. characterName：角色名（必须与出场角色列表中的名字完全一致）",
    "2. newGoal（可选）：角色的当前目标是否因本章事件而改变？",
    "3. newLocation（可选）：角色的物理位置是否移动？",
    "4. relationshipChanges（可选）：角色之间的信任度、亲密感、冲突程度是否变化？",
    "不编造正文中不存在的变化。",
  ].join("\n"),
});

// ── Post-Write: Chapter Summary ──────────────────────────

promptRegistry.register({
  id: "novel.chapter.summarize",
  taskType: "extractor", version: "v1",
  systemPrompt: "请用 200-300 字概括以下小说章节的核心事件、冲突和结局。",
});
