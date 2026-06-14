import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";

const WorldRulesOutput = z.object({
  rules: z.array(z.object({
    category: z.string(),
    title: z.string(),
    content: z.string(),
    priority: z.number(),
    referenceSource: z.string(),
  })),
});

export async function generateWorldRulesFromReference(
  novelId: string,
  referenceDescription: string,
): Promise<Array<{ id: string; category: string; title: string; content: string; priority: number }>> {
  const prisma = getPrisma();

  const result = await aiInvoke({
    assetId: "world.reference",
    userPrompt: `参考作品描述：\n${referenceDescription}\n\n提取世界规则并直接存储。每个规则 category 为：势力格局|力量体系|资源规则|社会结构|地理环境|历史背景。`,
    schema: WorldRulesOutput,
    temperature: 0.5,
  });

  const created: Array<{ id: string; category: string; title: string; content: string; priority: number }> = [];
  for (const rule of result.rules) {
    const r = await prisma.worldRule.create({
      data: { novelId, category: rule.category, title: rule.title, content: rule.content, priority: rule.priority },
    });
    created.push(r);
  }
  return created;
}
