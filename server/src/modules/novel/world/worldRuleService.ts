/**
 * World Rule Service — CRUD + batch AI generation + conflict detection.
 * ADAPTED from OP worldStructure.ts + worldServiceShared.ts.
 */

import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

// ─── Types ─────────────────────────────────────────────

export const WORLD_CATEGORIES = [
  "势力格局", "力量体系", "资源规则", "社会结构", "地理环境", "历史背景",
] as const;
export type WorldCategory = typeof WORLD_CATEGORIES[number];

export interface WorldRuleData {
  id: string;
  novelId: string;
  category: WorldCategory;
  title: string;
  content: string;
  priority: number;
  status: string;
  conflictsWith: string[] | null;
  activatedAt: string[] | null;
}

// ─── CRUD ──────────────────────────────────────────────

export async function listRules(novelId: string, category?: string) {
  const prisma = getPrisma();
  const where: Record<string, unknown> = { novelId };
  if (category) where.category = category;
  return prisma.worldRule.findMany({ where, orderBy: [{ category: "asc" }, { priority: "desc" }] }) as Promise<WorldRuleData[]>;
}

export async function createRule(novelId: string, data: { category: string; title: string; content: string; priority?: number }) {
  const prisma = getPrisma();
  return prisma.worldRule.create({
    data: { novelId, category: data.category, title: data.title, content: data.content, priority: data.priority ?? 0 },
  });
}

export async function updateRule(ruleId: string, data: Partial<{ title: string; content: string; category: string; priority: number; status: string }>) {
  const prisma = getPrisma();
  return prisma.worldRule.update({ where: { id: ruleId }, data });
}

export async function deleteRule(ruleId: string) {
  const prisma = getPrisma();
  return prisma.worldRule.delete({ where: { id: ruleId } });
}

// ─── AI Batch Generation ───────────────────────────────

const BatchGenerateSchema = z.object({
  rules: z.array(z.object({
    category: z.string().optional().default("未分类"),
    title: z.string().optional().default("新规则"),
    content: z.string().optional().default(""),
    priority: z.number().min(0).max(10).optional().default(5),
  })).max(50),
});

export async function batchGenerateRules(novelId: string): Promise<WorldRuleData[]> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  const systemPrompt = [
    "你是资深小说世界观设计师。根据小说信息，生成分类明确、可执行、可验证的世界规则。",
    "",
    `分类维度（共6类，尽量覆盖多类，不要求每类都有）：${WORLD_CATEGORIES.join("、")}`,
    "",
    "规则要求：",
    "1. 每条10-50字，具体可操作，可验证（能判断'本章是否违反此规则'）",
    "2. priority(1-10)：10=核心不可违背，5=重要但不绝对，1=锦上添花",
    "3. 至少生成5条规则，覆盖主要分类维度",
    "4. 势力格局：有哪些势力、谁控制什么、势力间基本关系",
    "5. 力量体系：修炼/魔法/科技等级、获取方式、使用代价/限制",
    "6. 资源规则：稀缺资源是什么、谁拥有、如何获取/消耗",
    "7. 社会结构：阶层划分、流动规则、权力来源",
    "8. 地理环境：关键地点、区位关系、环境约束",
    "9. 历史背景：关键历史事件对当下的影响、遗留问题",
    "10. 规则之间不得逻辑矛盾。优先基于已有信息归纳，合理补充但不做过度发散。",
    "",
    "只输出JSON。",
  ].join("\n");

  const context = [
    `书名：《${novel.title}》`,
    novel.genre ? `题材：${novel.genre}` : "",
    novel.description ? `概述：${novel.description}` : "",
    `大纲：${(novel.structuredOutline ?? "").slice(0, 3000)}`,
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    task: "extractor",
    systemPrompt,
    userPrompt: context,
    schema: BatchGenerateSchema,
    temperature: 0.6,
  });

  // Guard: if AI returned no rules, keep existing ones
  if (raw.rules.length === 0) {
    return listRules(novelId);
  }

  // Transaction: delete old + insert new atomically
  // If insertion fails midway, old rules are preserved (rollback)
  const created = await prisma.$transaction(async (tx) => {
    await tx.worldRule.deleteMany({ where: { novelId } });

    const results: WorldRuleData[] = [];
    for (const r of raw.rules) {
      const rule = await tx.worldRule.create({
        data: {
          novelId,
          category: r.category ?? "未分类",
          title: r.title ?? "新规则",
          content: r.content ?? "",
          priority: Math.round(r.priority ?? 5),
        },
      });
      results.push(rule as WorldRuleData);
    }
    return results;
  });

  return created;
}

// ─── Conflict Detection ────────────────────────────────

const ConflictCheckSchema = z.object({
  hasConflict: z.boolean(),
  conflictingRuleIds: z.array(z.string()).optional().default([]),
  explanation: z.string().optional().default(""),
});

export async function checkConflict(ruleId: string): Promise<{ hasConflict: boolean; conflictingIds: string[]; explanation: string }> {
  const prisma = getPrisma();
  const rule = await prisma.worldRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new Error("Rule not found");

  const allRules = await prisma.worldRule.findMany({
    where: { novelId: rule.novelId, id: { not: ruleId }, status: "active" },
  });
  if (allRules.length === 0) return { hasConflict: false, conflictingIds: [], explanation: "" };

  const raw = await aiInvoke({
    task: "compiler",
    systemPrompt: [
      "你是小说世界观一致性审查员。检查两条规则之间是否存在逻辑矛盾。",
      "矛盾类型：",
      "- 直接对立：A说「只有贵族能修炼」B说「任何人都能修炼」→ 矛盾",
      "- 隐含冲突：A说「魔法需要等价交换」B说「主角天生无限魔力」→ 矛盾",
      "- 前提不一致：A基于'世界没有神'，B说'神赐予力量'→ 矛盾",
      "如果没有矛盾，返回 hasConflict=false。只输出JSON。",
    ].join("\n"),
    userPrompt: `目标规则：[${rule.category}] ${rule.title}: ${rule.content}\n\n对比以下规则：\n${allRules.map(r => `[${r.id}] [${r.category}] ${r.title}: ${r.content}`).join("\n")}`,
    schema: ConflictCheckSchema,
    temperature: 0.2,
  });

  return { hasConflict: raw.hasConflict, conflictingIds: raw.conflictingRuleIds ?? [], explanation: raw.explanation ?? "" };
}

export async function checkAllConflicts(novelId: string): Promise<Array<{ ruleId: string; title: string; conflicts: Array<{ ruleId: string; title: string; explanation: string }> }>> {
  const rules = await listRules(novelId);
  const results: Array<{ ruleId: string; title: string; conflicts: Array<{ ruleId: string; title: string; explanation: string }> }> = [];

  // Compare pairs (only check each pair once)
  const checked = new Set<string>();
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const key = `${rules[i].id}-${rules[j].id}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const check = await checkConflict(rules[i].id);
      if (check.hasConflict) {
        const conflicts = check.conflictingIds.map(id => ({
          ruleId: id,
          title: rules.find(r => r.id === id)?.title ?? "",
          explanation: check.explanation,
        }));
        if (conflicts.length > 0) {
          results.push({ ruleId: rules[i].id, title: rules[i].title, conflicts });
        }
      }
    }
    // Only check first 15 rules pairwise to avoid explosion
    if (i > 15) break;
  }

  return results;
}

export async function resolveConflict(ruleId: string, resolution: "keep" | "deprecate") {
  const prisma = getPrisma();
  if (resolution === "deprecate") {
    return prisma.worldRule.update({ where: { id: ruleId }, data: { status: "deprecated", conflictsWith: null } });
  }
  // Keep: clear conflictsWith
  return prisma.worldRule.update({ where: { id: ruleId }, data: { conflictsWith: null } });
}
