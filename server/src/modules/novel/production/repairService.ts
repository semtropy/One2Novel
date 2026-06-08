import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";

const RepairSchema = z.object({ repairedText: z.string(), changesSummary: z.string() });

export async function patchRepair(content: string, issues: string): Promise<string> {
  const r = await aiInvoke({
    task: "repairer",
    systemPrompt: [
      "你是资深小说修改编辑。当前章节存在局部问题，需要进行最小化、可承受风险的修补。",
      "修补规则：",
      "1. 只修改问题段落及其最紧密的上下文，不得重写整章或改变整体主线和结构。",
      "2. 优先保护已存在的人物对话、设定细节和已有伏笔。",
      "3. 修补后正文应自然流畅，不得出现明显的拼接断裂、语气突变或信息丢失。",
      "4. 如果所有修复方案都会导致显著不一致，优先选择语义代价最小、信息丢失最少的方案。",
    ].join("\n"),
    userPrompt: `审查意见：\n${issues}\n\n原文：\n${content.slice(0, 8000)}`,
    schema: RepairSchema, temperature: 0.5,
  });
  return r.repairedText;
}

export async function heavyRepair(content: string, issues: string): Promise<string> {
  const r = await aiInvoke({
    task: "repairer",
    systemPrompt: [
      "你是资深小说修改编辑。当前章节需要深度重写。",
      "重写规则：",
      "1. 保留本章必须完成的chapter_mission和ending hook。",
      "2. 保留出场角色及其当前角色状态，不得擅自删除角色或改变其核心性格。",
      "3. 保留所有已兑现和正在铺垫的payoff/伏笔。",
      "4. 禁止引入新设定、新规则或未铺垫的转折。",
      "5. 重写后正文必须自然流畅，风格一致，不得看起来像两个不同人拼起来的。",
    ].join("\n"),
    userPrompt: `审查意见：\n${issues}\n\n原文：\n${content.slice(0, 8000)}`,
    schema: RepairSchema, temperature: 0.7,
  });
  return r.repairedText;
}

export async function repairChapter(content: string, issues: string): Promise<string> {
  return patchRepair(content, issues);
}
