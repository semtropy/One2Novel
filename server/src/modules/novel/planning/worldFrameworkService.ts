/**
 * Unified World Framework generation service.
 *
 * Extracted from planning.routes.ts. Runs three serial AI calls:
 * 1. World rules (6 categories) → persists to WorldRule table
 * 2. Power system tree → persists to novel.powerSystemTree
 * 3. Golden finger → persists to novel.goldenFinger
 *
 * Each step receives the output of previous steps as context.
 */
import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import type { PowerNode } from "./powerSystemService";

const worldRulesSchema = z.object({
  rules: z.array(z.object({
    category: z.string(),
    title: z.string(),
    content: z.string(),
    priority: z.number(),
  })),
});

const PowerNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string(),
    breakthroughCondition: z.string(),
    abilityUpgrade: z.string(),
    children: z.array(PowerNodeSchema).default([]),
  })
);
const powerSystemSchema = z.object({ levels: z.array(PowerNodeSchema) });

const goldenFingerSchema = z.object({
  goldenFingerName: z.string(),
  abilities: z.array(z.string()),
  limits: z.array(z.string()),
});

export interface WorldFrameworkResult {
  worldRules: Array<{ category: string; title: string; content: string; priority: number }>;
  powerSystemTree: PowerNode[] | null;
  goldenFinger: { goldenFingerName: string; abilities: string[]; limits: string[] };
}

export async function generateWorldFramework(novelId: string): Promise<WorldFrameworkResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      storySummary: true, centralQuestion: true, endingDirection: true,
      genre: true, architectureType: true, tonePitch: true, activeProfileId: true,
    },
  });
  if (!novel) throw new Error("Novel not found");

  // Build reference context from active profile
  let referenceContext = "";
  if (novel.activeProfileId) {
    const rp = await prisma.referenceProfile.findUnique({
      where: { id: novel.activeProfileId },
      select: { analysisResult: true },
    });
    if (rp?.analysisResult) {
      try {
        const ar = JSON.parse(rp.analysisResult);
        const ap = ar.architecture?.architectureProfile;
        if (ap) {
          referenceContext += `\n【对标书架构数据】章节分布：推进${ap.chapterTypeDistribution?.advance}%/过渡${ap.chapterTypeDistribution?.transition}%/冷却${ap.chapterTypeDistribution?.cooldown}%/高潮${ap.chapterTypeDistribution?.climax}% | 每回环${ap.avgChaptersPerLoop?.avg}章 | 爽点：升级${ap.coolPointRecipe?.upgrade}%/收集${ap.coolPointRecipe?.collect}%/策略${ap.coolPointRecipe?.strategy}%`;
        }
        const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern;
        if (dp) {
          referenceContext += `\n【对标书金手指模式】${dp.type}：${dp.coreMechanic}`;
        }
      } catch (e) { /* ignore parse errors */ console.error(`[WorldFramework] Reference JSON parse failed: ${e instanceof Error ? e.message : e}`); }
    }
  }

  const baseContext = [
    novel.storySummary ? `故事简介：${novel.storySummary}` : "",
    novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
    novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
    novel.genre ? `题材：${novel.genre}` : "",
    novel.architectureType ? `架构类型：${novel.architectureType}` : "",
    novel.tonePitch ? `语气基调：${novel.tonePitch}` : "",
    referenceContext,
  ].filter(Boolean).join("\n");

  // Step 1: World Rules
  const worldRules = await aiInvoke({
    assetId: "world.rules.generate",
    userPrompt: [
      baseContext,
      "生成6个分类的世界规则（势力格局/力量体系/资源规则/社会结构/地理环境/历史背景），每个分类至少1条。优先参考对标书数据。",
    ].join("\n"),
    schema: worldRulesSchema,
    temperature: 0.6,
    novelId,
  });

  // Persist world rules (delete old, create new)
  await prisma.worldRule.deleteMany({ where: { novelId } });
  for (const r of worldRules.rules) {
    await prisma.worldRule.create({
      data: { novelId, category: r.category, title: r.title, content: r.content, priority: r.priority },
    });
  }
  const rulesSummary = worldRules.rules
    .map(r => `[${r.category}] ${r.title}: ${r.content}`)
    .join("\n");

  // Step 2: Power System Tree (may fail gracefully)
  let powerSystemTree: PowerNode[] | null = null;
  try {
    const ps = await aiInvoke({
      assetId: "novel.power-system.generate",
      userPrompt: [
        baseContext,
        `世界规则：\n${rulesSummary}`,
        "根据以上世界规则和故事核心，设计力量体系境界树。每个境界必须有具体突破条件和能力跃迁。",
      ].join("\n"),
      schema: powerSystemSchema,
      temperature: 0.7,
      novelId,
    });
    await prisma.novel.update({
      where: { id: novelId },
      data: { powerSystemTree: JSON.stringify(ps.levels) },
    });
    powerSystemTree = ps.levels;
  } catch (e) {
    console.warn("[WorldFramework] Power system generation failed", e);
  }

  // Step 3: Golden Finger
  let designPatternContext = "";
  if (novel.activeProfileId) {
    try {
      const rp = await prisma.referenceProfile.findUnique({
        where: { id: novel.activeProfileId },
        select: { analysisResult: true },
      });
      if (rp?.analysisResult) {
        const ar = JSON.parse(rp.analysisResult);
        const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern;
        if (dp) {
          designPatternContext = `\n【参考书设计模式（few-shot）】类型：${dp.type} — ${dp.typeDescription}\n核心机制：${dp.coreMechanic}\n获取方式：${dp.acquisitionPattern}\n进化路径：${dp.evolutionPath?.join(" → ")}\n限制策略：${dp.limitationStrategy}`;
        }
      }
    } catch (e) { /* ignore parse errors */ console.error(`[WorldFramework] Golden finger reference JSON parse failed: ${e instanceof Error ? e.message : e}`); }
  }
  const powerSummary = powerSystemTree
    ? `\n力量体系：${powerSystemTree.map((l: any) => l.name).join(" → ")}`
    : "";
  const gf = await aiInvoke({
    assetId: "novel.golden-finger.generate",
    userPrompt: [
      baseContext,
      `世界规则：\n${rulesSummary}`,
      powerSummary,
      designPatternContext,
      "设计金手指——它是主角在世界规则和力量体系中的例外。能力和限制必须具体可操作。",
    ].filter(Boolean).join("\n"),
    schema: goldenFingerSchema,
    temperature: 0.8,
    novelId,
  });
  await prisma.novel.update({
    where: { id: novelId },
    data: { goldenFinger: JSON.stringify(gf) },
  });

  return { worldRules: worldRules.rules, powerSystemTree, goldenFinger: gf };
}
