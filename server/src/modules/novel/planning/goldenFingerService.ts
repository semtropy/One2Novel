/**
 * Golden Finger AI generation service.
 *
 * Extracted from planning.routes.ts — fetches novel context, calls AI,
 * persists result, returns typed output.
 */
import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

const GoldenFingerOutput = z.object({
  goldenFingerName: z.string(),
  abilities: z.array(z.string()),
  limits: z.array(z.string()),
});

export interface GoldenFingerResult {
  goldenFingerName: string;
  abilities: string[];
  limits: string[];
}

export async function generateGoldenFinger(novelId: string): Promise<GoldenFingerResult> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      storySummary: true, centralQuestion: true, endingDirection: true,
      genre: true, architectureType: true, description: true,
      worldRules: { select: { category: true, title: true, content: true }, where: { status: "active" } },
    },
  });
  if (!novel) throw new Error("Novel not found");

  // Reference profile design pattern injection
  let designPatternContext = "";
  const activeProfileId = (await prisma.novel.findUnique({
    where: { id: novelId },
    select: { activeProfileId: true },
  }))?.activeProfileId;
  if (activeProfileId) {
    const refProfile = await prisma.referenceProfile.findUnique({
      where: { id: activeProfileId },
      select: { analysisResult: true },
    });
    if (refProfile?.analysisResult) {
      try {
        const ar = JSON.parse(refProfile.analysisResult);
        const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern;
        if (dp) {
          designPatternContext = `\n【参考书设计模式（few-shot）】\n类型：${dp.type} — ${dp.typeDescription}\n核心机制：${dp.coreMechanic}\n获取方式：${dp.acquisitionPattern}\n进化路径：${dp.evolutionPath?.join(" → ") ?? ""}\n限制策略：${dp.limitationStrategy}\n叙事融合：${dp.narrativeIntegration}`;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  const result = await aiInvoke({
    assetId: "novel.golden-finger.generate",
    userPrompt: [
      novel.storySummary ? `故事简介：${novel.storySummary}` : "",
      novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
      novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
      novel.genre ? `题材：${novel.genre}` : "",
      novel.architectureType ? `架构类型：${novel.architectureType}` : "",
      novel.description ? `灵感描述：${novel.description}` : "",
      novel.worldRules.length > 0
        ? `世界规则：${novel.worldRules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join("\n")}`
        : "",
      designPatternContext,
    ].filter(Boolean).join("\n"),
    schema: GoldenFingerOutput,
    temperature: 0.8,
    novelId,
  });

  // Persist to DB
  await prisma.novel.update({
    where: { id: novelId },
    data: { goldenFinger: JSON.stringify(result) },
  });

  return result;
}
