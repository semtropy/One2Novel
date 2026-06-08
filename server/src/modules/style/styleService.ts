import { z } from "zod";
import { getPrisma } from "../../platform/db/client";
import { aiInvoke } from "../../platform/llm/aiService";

// LLM may return string or string[] for rule fields — normalize to array
const StringOrArray = z.union([z.array(z.string()), z.string().transform(s => [s])]).pipe(z.array(z.string()));

const ExtractSchema = z.object({
  narrativeRules: StringOrArray, languageRules: StringOrArray, characterRules: StringOrArray,
  rhythmRules: StringOrArray, antiAiRules: StringOrArray, overallDescription: z.string(),
});
export type ExtractedFeatures = z.infer<typeof ExtractSchema>;

export async function listStyleProfiles() { return getPrisma().styleProfile.findMany({ orderBy: { updatedAt: "desc" } }); }
export async function getStyleProfile(id: string) { return getPrisma().styleProfile.findUnique({ where: { id }, include: { bindings: true } }); }
export async function createStyleProfile(data: { name: string; sourceText?: string }) { return getPrisma().styleProfile.create({ data: { name: data.name, sourceText: data.sourceText, category: data.sourceText ? "uploaded" : "manual" } }); }
export async function deleteStyleProfile(id: string) { return getPrisma().styleProfile.delete({ where: { id } }); }
export async function updateStyleProfile(id: string, data: { name?: string }) { return getPrisma().styleProfile.update({ where: { id }, data }); }

export async function extractStyle(profileId: string): Promise<ExtractedFeatures> {
  const prisma = getPrisma();
  const profile = await prisma.styleProfile.findUnique({ where: { id: profileId } });
  if (!profile?.sourceText) throw new Error("No source text");

  const result = await aiInvoke({
    task: "extractor",
    systemPrompt: [
      "你是专业写作风格分析师。分析提供的文本样本，提取该作者的写作特征。",
      "",
      "输出维度：",
      "1. narrativeRules(叙事规则)：叙事视角、节奏偏好、信息揭示方式、情节推进特点",
      "2. languageRules(语言规则)：句式特征、修辞偏好、词汇选择、语气语调",
      "3. characterRules(角色处理)：角色塑造方式、对话风格、心理描写偏好",
      "4. rhythmRules(节奏规则)：段落长度偏好、叙述与对话比例、高潮低谷分布",
      "5. antiAiRules(反AI规则)：识别与通用AI写作相区别的独特表达特征",
      "6. overallDescription(整体描述)：50-100字的风格总结",
      "",
      "每条规则10-30字，要具体可操作。只输出JSON。",
    ].join("\n"),
    userPrompt: `分析以下文本风格：\n\n${profile.sourceText.slice(0, 10000)}`,
    schema: ExtractSchema, temperature: 0.5,
  });

  await prisma.styleProfile.update({ where: { id: profileId }, data: { extractedFeatures: JSON.stringify(result), narrativeRules: JSON.stringify(result.narrativeRules), languageRules: JSON.stringify(result.languageRules), characterRules: JSON.stringify(result.characterRules), rhythmRules: JSON.stringify(result.rhythmRules), antiAiRules: JSON.stringify(result.antiAiRules) } });
  return result;
}

export async function bindStyle(styleProfileId: string, targetType: "novel" | "chapter", targetId: string) { return getPrisma().styleBinding.create({ data: { styleProfileId, targetType, targetId } }); }
export async function unbindStyle(bindingId: string) { return getPrisma().styleBinding.delete({ where: { id: bindingId } }); }
export async function getStyleBindings(targetType: string, targetId: string) { return getPrisma().styleBinding.findMany({ where: { targetType, targetId, enabled: true }, include: { styleProfile: true }, orderBy: { priority: "desc" } }); }

const RULE_FIELDS = ["narrativeRules","languageRules","characterRules","rhythmRules","antiAiRules"] as const;
type RuleField = (typeof RULE_FIELDS)[number];

function isRuleField(f: string): f is RuleField { return (RULE_FIELDS as readonly string[]).includes(f); }

export async function updateRuleInProfile(id: string, field: string, index: number, text: string) {
  if (!isRuleField(field)) throw new Error(`Invalid field: ${field}`);
  const prisma = getPrisma();
  const profile = await prisma.styleProfile.findUnique({ where: { id } });
  if (!profile) throw new Error("Profile not found");
  const arr: string[] = JSON.parse((profile as unknown as Record<string, string>)[field] ?? "[]");
  if (index < 0 || index >= arr.length) throw new Error("Index out of range");
  arr[index] = text;
  await prisma.styleProfile.update({ where: { id }, data: { [field]: JSON.stringify(arr) } });
  return { field, index, text };
}

export async function addRuleToProfile(id: string, field: string, text: string) {
  if (!isRuleField(field)) throw new Error(`Invalid field: ${field}`);
  const prisma = getPrisma();
  const profile = await prisma.styleProfile.findUnique({ where: { id } });
  if (!profile) throw new Error("Profile not found");
  const arr: string[] = JSON.parse((profile as unknown as Record<string, string>)[field] ?? "[]");
  arr.push(text);
  await prisma.styleProfile.update({ where: { id }, data: { [field]: JSON.stringify(arr) } });
  return { field, index: arr.length - 1, text };
}

export async function deleteRuleFromProfile(id: string, field: string, index: number) {
  if (!isRuleField(field)) throw new Error(`Invalid field: ${field}`);
  const prisma = getPrisma();
  const profile = await prisma.styleProfile.findUnique({ where: { id } });
  if (!profile) throw new Error("Profile not found");
  const arr: string[] = JSON.parse((profile as unknown as Record<string, string>)[field] ?? "[]");
  if (index < 0 || index >= arr.length) throw new Error("Index out of range");
  arr.splice(index, 1);
  await prisma.styleProfile.update({ where: { id }, data: { [field]: JSON.stringify(arr) } });
  return { field, index };
}

export async function getStyleContext(novelId: string): Promise<string> {
  const bindings = await getPrisma().styleBinding.findMany({ where: { targetType: "novel", targetId: novelId, enabled: true }, include: { styleProfile: true } });
  if (bindings.length === 0) return "";
  const rules: string[] = [];
  for (const b of bindings) for (const field of ["narrativeRules","languageRules","characterRules","rhythmRules","antiAiRules"] as const) {
    try { const arr = JSON.parse((b.styleProfile as unknown as Record<string, string>)[field] ?? "[]"); if (Array.isArray(arr)) rules.push(...arr.map((r: string) => `[${field.replace("Rules","")}] ${r}`)); } catch {}
  }
  return rules.length > 0 ? `## 写法约束\n${rules.map((r) => `- ${r}`).join("\n")}` : "";
}
