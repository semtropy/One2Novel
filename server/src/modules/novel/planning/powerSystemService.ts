/**
 * Power System Tree AI generation service.
 *
 * Extracted from planning.routes.ts — fetches novel context, calls AI
 * to generate a cultivation / progression tree, persists result.
 */
import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

const PowerNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string(),
    breakthroughCondition: z.string(),
    abilityUpgrade: z.string(),
    children: z.array(PowerNodeSchema).default([]),
  })
);
const PowerSystemOutput = z.object({ levels: z.array(PowerNodeSchema) });

export interface PowerNode {
  name: string;
  breakthroughCondition: string;
  abilityUpgrade: string;
  children: PowerNode[];
}

export async function generatePowerSystem(novelId: string): Promise<PowerNode[]> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: {
      storySummary: true, centralQuestion: true, endingDirection: true,
      genre: true, architectureType: true, tonePitch: true,
    },
  });
  if (!novel) throw new Error("Novel not found");

  const context = [
    novel.storySummary ? `故事简介：${novel.storySummary}` : "",
    novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
    novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
    novel.genre ? `题材：${novel.genre}` : "",
    novel.architectureType ? `架构类型：${novel.architectureType}` : "",
    novel.tonePitch ? `语气基调：${novel.tonePitch}` : "",
  ].filter(Boolean).join("\n");

  const result = await aiInvoke({
    assetId: "novel.power-system.generate",
    userPrompt: context,
    schema: PowerSystemOutput,
    temperature: 0.7,
    novelId,
  });

  // Persist to Novel
  await prisma.novel.update({
    where: { id: novelId },
    data: { powerSystemTree: JSON.stringify(result.levels) },
  });

  return result.levels;
}
