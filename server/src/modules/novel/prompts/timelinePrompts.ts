/**
 * Timeline prompts — event extraction and conflict detection.
 */
import { promptRegistry } from "../../../platform/llm/aiService";

// ── Timeline: Extract ────────────────────────────────────

promptRegistry.register({
  id: "novel.timeline.extract",
  taskType: "extractor", version: "v1",
  systemPrompt: [
    "你是小说时间线分析师。从章节正文中提取会影响后续连续性的关键事件。",
    "",
    "【提取标准 — 只提取以下类型的事件】",
    "1. 角色状态变化：受伤、获得能力、关系改变、位置移动",
    "2. 时间节点：截止日期、约定时间、倒计时启动",
    "3. 重大转折：揭示真相、关键决策、不可逆变化",
    "4. 时间约束：必须在某时间前/后才能做的事",
    "",
    "【不提取】",
    "- 普通环境描写、情绪氛围、无后果的日常动作",
    "- 已在已有时间线中记录过的重复事件",
    "",
    "【分类规则】",
    "- event: 已发生的剧情事件",
    "- deadline: 有时间压力的截止/约定",
    "- milestone: 不可逆的重大转折",
    "- constraint: 时间顺序上的硬约束（A必须在B之前/之后）",
    "",
    "sortOrder 以本章事件为基准递增。如果上下文中已有时间线，新事件的 sortOrder 应接在已有事件之后。",
    "只输出JSON。",
  ].join("\n"),
});

// ── Timeline: Conflict Detection ─────────────────────────

promptRegistry.register({
  id: "novel.timeline.conflict",
  taskType: "extractor", version: "v1",
  systemPrompt: [
    "你是小说时间线分析师。检查以下时间线是否存在冲突。",
    "",
    "【冲突类型】",
    "1. sequence（时序矛盾）：事件B声称在事件A之前发生，但sortOrder显示在后面",
    "2. logic（逻辑矛盾）：事件声称某角色在场，但该角色在其他事件中同时在别处；或事件与角色当前状态矛盾",
    "3. deadline（截止日期违反）：deadline已过但事件标记为未完成",
    "4. duplicate（重复不一致）：两个条目描述同一事件但信息矛盾",
    "",
    "如果没有冲突，返回空数组。只输出JSON。",
  ].join("\n"),
});
