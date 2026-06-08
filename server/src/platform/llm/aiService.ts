import type { z } from "zod";
import { invokeStructuredLlm } from "./structuredInvoke";
import { createLLM, type LLMProvider } from "./provider";
import { generateFormatHint } from "./schemaFormatHint";

export type TaskType = "writer" | "reviewer" | "planner" | "extractor" | "compiler" | "repairer";

// ─── Preferred Provider (Phase 16) ─────────────────

export function getPreferredProvider(): LLMProvider {
  try {
    // Dynamic import to avoid circular dependency
    const { getPreferences } = require("../../modules/settings/preferences");
    const prefs = getPreferences();
    return (prefs?.defaultProvider as LLMProvider) ?? "deepseek";
  } catch { return "deepseek"; }
}

// ─── Context Group Definition ──────────────────────

export interface ContextRequirement {
  group: string;
  required?: boolean;
  priority: number;
}

export interface PromptAssetDef {
  id: string;
  taskType: TaskType;
  version: string;
  contextRequirements: ContextRequirement[];
  contextPolicy: {
    maxTokensBudget: number;
    requiredGroups: string[];
    preferredGroups: string[];
    dropOrder: string[];
  };
  systemPrompt: string;
}

// ─── Model Router ───────────────────────────────────

const TASK_MODEL: Record<TaskType, { temperature: number; maxTokens: number }> = {
  writer:    { temperature: 0.85, maxTokens: 8192 },
  reviewer:  { temperature: 0.3,  maxTokens: 2048 },
  planner:   { temperature: 0.8,  maxTokens: 8192 },
  extractor: { temperature: 0.5,  maxTokens: 4096 },
  compiler:  { temperature: 0.3,  maxTokens: 2048 },
  repairer:  { temperature: 0.5,  maxTokens: 8192 },
};

// ─── Prompt Registry ────────────────────────────────

const prompts = new Map<string, PromptAssetDef>();

export const promptRegistry = {
  register(def: PromptAssetDef) { prompts.set(def.id, def); },
  get(id: string): PromptAssetDef | undefined { return prompts.get(id); },
  getByTask(task: TaskType): PromptAssetDef[] {
    return [...prompts.values()].filter(p => p.taskType === task);
  },
};

// ─── Register Core Prompts (from old project's 70) ──

promptRegistry.register({
  id: "novel.chapter.writer.v5",
  taskType: "writer", version: "v5",
  contextRequirements: [
    { group: "book_contract", required: true, priority: 104 },
    { group: "chapter_mission", required: true, priority: 100 },
    { group: "previous_chapter_hook", required: true, priority: 100 },
    { group: "character_hard_facts", required: true, priority: 99 },
    { group: "style_contract", required: true, priority: 74 },
    { group: "payoff_directives", priority: 98 },
    { group: "story_macro", priority: 98 },
    { group: "volume_window", required: true, priority: 96 },
    { group: "open_conflicts", priority: 88 },
    { group: "recent_chapters", priority: 86 },
    { group: "opening_constraints", priority: 80 },
  ],
  contextPolicy: {
    maxTokensBudget: 12000,
    requiredGroups: ["chapter_mission", "character_hard_facts", "style_contract", "volume_window", "book_contract"],
    preferredGroups: ["previous_chapter_hook", "open_conflicts", "recent_chapters", "payoff_directives", "story_macro"],
    dropOrder: ["opening_constraints", "story_macro"],
  },
  systemPrompt: `你是中文长篇网络小说写作助手。生成可直接阅读的正文，不是提纲或解释。

## 三大黄金法则
1. **展示而非讲述**：用动作和对话表现，不要直接陈述
2. **冲突驱动剧情**：必须有明确的冲突或转折
3. **悬念承上启下**：章尾必须设置强钩子

## 结构要求
1. 开头迅速进入情境，不得铺垫背景或复述上一章
2. 中段必须出现推进、变化或对抗
3. 至少一次明确的状态变化（反转/升级/关系变化/风险上升）

## 连续性约束
- 开头与上文明显区分，禁止复用相同开场模式
- 允许短回调，不得大段复述已发生事件
- 延续人物状态与局面，不得让角色行为失去动机

## 篇幅要求
3000-5000字，对话比例≥30%，至少1个读者预期之外的转折

## 禁止（AI痕迹清除）
- 禁止：璀璨、瑰丽、心潮澎湃、热血沸腾、油然而生等陈词
- 禁止：大段内心独白代替行动
- 禁止：直接陈述情感（用身体反应代替）
- 禁止：无信息量的寒暄对话
- 禁止：「此外」「然而」「值得注意的是」等AI常用连接词
- 禁止：重复回顾、空泛心理独白、无信息量描写硬凑字数
- 禁止：用总结性语句代替剧情发展
- 禁止：整章只有情绪或氛围而缺乏事件推进
- 禁止：跳跃式推进导致逻辑断裂
- 禁止：引入未铺垫的重大转折

直接输出正文，不需要章节标题。`,
});

promptRegistry.register({
  id: "novel.chapter.review.v3",
  taskType: "reviewer", version: "v3",
  contextRequirements: [
    { group: "chapter_content", required: true, priority: 100 },
  ],
  contextPolicy: {
    maxTokensBudget: 4000,
    requiredGroups: ["chapter_content"],
    preferredGroups: [],
    dropOrder: [],
  },
  systemPrompt: `你是资深中文编辑。按7维度评分(1-10)：开头吸引力、情节推进、人物塑造、对话质量、悬念设置、节奏控制、语言质量。给出人话评语和具体修复建议。只输出JSON。`,
});

promptRegistry.register({
  id: "novel.outline.generate.v3",
  taskType: "planner", version: "v3",
  contextRequirements: [
    { group: "book_contract", required: true, priority: 100 },
  ],
  contextPolicy: {
    maxTokensBudget: 8000,
    requiredGroups: ["book_contract"],
    preferredGroups: [],
    dropOrder: [],
  },
  systemPrompt: `你是资深小说作者+剧情策划编辑。将用户想法重构为「故事引擎原型」，具备持续叙事能力。
结构：发现→介入→升级→反噬→反转→再发现的循环推进。
题材适配：悬疑→信息揭示节奏+认知误导；成长→代价+自我重构；奇幻→世界观一致。
2-4卷，每卷5-8章，章节标题≤8字，每章hook必须让读者想看下一章。
只输出JSON。`,
});

promptRegistry.register({
  id: "novel.character.extract.v2",
  taskType: "extractor", version: "v2",
  contextRequirements: [
    { group: "story_macro", required: true, priority: 100 },
    { group: "chapter_list", priority: 90 },
  ],
  contextPolicy: {
    maxTokensBudget: 6000,
    requiredGroups: ["story_macro"],
    preferredGroups: ["chapter_list"],
    dropOrder: [],
  },
  systemPrompt: `你是专业角色设计师。从大纲提取角色阵容。每个角色要有性格核心(行为体现)、致命缺陷(导致失败)、发展弧线、说话风格。使用侧面展示(行为/选择)描述性格，不要贴标签。只输出JSON。`,
});

// ─── Unified AI Invocation ──────────────────────────

export async function aiInvoke<T extends z.ZodType>(opts: {
  task: TaskType;
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
}) {
  const route = TASK_MODEL[opts.task];
  const formatHint = generateFormatHint(opts.schema);
  // Prepend format constraints at the TOP so the LLM sees them first (not appended at bottom)
  const systemPrompt = formatHint
    ? formatHint + "\n\n---\n\n" + opts.systemPrompt
    : opts.systemPrompt;
  return invokeStructuredLlm({
    provider: getPreferredProvider(),
    temperature: opts.temperature ?? route.temperature,
    maxTokens: opts.maxTokens ?? route.maxTokens,
    maxRetries: opts.maxRetries,
    systemPrompt,
    userPrompt: opts.userPrompt,
    schema: opts.schema,
  });
}

export function aiGenerate(opts: { task: TaskType; temperature?: number }) {
  const route = TASK_MODEL[opts.task];
  return createLLM(getPreferredProvider(), { temperature: opts.temperature ?? route.temperature, maxTokens: route.maxTokens });
}
