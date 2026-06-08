import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { getPrisma } from "../../../../platform/db/client";
import { injectSkillRules } from "../../../../platform/llm/skillRules";

const LLMCharacterSchema = z.object({
  name: z.string(), role: z.string(), personality: z.string(), background: z.string(),
  appearance: z.string().optional(), quirks: z.string().optional(),
  currentStatus: z.string().optional(),
  goal: z.string(), voice: z.string(),
  identity: z.string(), faction: z.string().optional(), flaw: z.string().optional(),
});
const LLMCharExtractSchema = z.object({
  characters: z.array(LLMCharacterSchema),
  relationships: z.array(z.object({ source: z.string(), target: z.string(), type: z.string(), summary: z.string() })).optional(),
});

export interface CharacterExtraction {
  characters: { name: string; role: string; personality: string; background: string; appearance?: string; quirks?: string; currentStatus?: string; currentGoal: string; voiceTexture: string; identityLabel: string; factionLabel?: string; prohibitions?: string }[];
  relationships: { source: string; target: string; type: string; summary: string }[];
}

function normRole(r?: string): string {
  if (!r) return "supporting";
  const v = r.toLowerCase();
  if (v.includes("主角")||v.includes("protagonist")) return "protagonist";
  if (v.includes("反派")||v.includes("antagonist")) return "antagonist";
  if (v.includes("配角")||v.includes("supporting")) return "supporting";
  return "minor";
}

export async function generateCharacters(novelId: string): Promise<CharacterExtraction> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId }, include: { chapters: { orderBy: { order: "asc" }, take: 30 } } });
  if (!novel) throw new Error("Novel not found");
  const outline = novel.structuredOutline ?? novel.outline ?? "";
  const chList = novel.chapters.map(c => `第${c.order}章 ${c.title}`).join("、");

  const basePrompt = [
    "你是长篇中文网文的角色阵容策划师，服务对象是不懂写作流程的新手用户。",
    "你的任务是为当前小说生成可直接进入正文的核心角色阵容。",
    "",
    "【命名硬规则】",
    "1. name 只能写可直接进入正文的真实人物名、稳定称谓或身份称呼。",
    "2. 绝对禁止把功能词写进 name，例如：谜团催化剂、知识导师位、外部威胁位。",
    "3. 同一方案内角色名必须彼此可区分。",
    "",
    "【阵容质量要求】",
    "1. 必须有明确主角锚点，主角不能写成功能位。",
    "2. 要体现真正的人物关系动力、压力来源、成长代价和长期冲突。",
    "3. 角色组合必须能支撑长篇推进。",
    "",
    "字段说明：",
    "name：角色真实人名或稳定称谓（2-3字中文），不能是功能词",
    "role：protagonist（主角）/ antagonist（对手）/ supporting（配角）/ minor（次要）",
    "personality：2-3个具体性格特质，用行为体现而非标签",
    "background：角色出身、关键关系与隐性负担的综合背景",
    "appearance：外貌体态着装一句话（30-80字），如\"苍白肤色，黑色短发，右眼下细疤，常穿全黑战术服\"",
    "quirks：1-2个标志性习惯动作（10-30字），如\"握剑前会先松再紧三下手指\"",
    "currentStatus：角色当前所处状态快照（10-40字），如\"身负重伤，独自追踪仇人到边境小镇\"",
    "goal：角色当前最想达成的短期目标，要具体可感知",
    "voice：说话风格描述（语速、用词偏好、习惯性语气词）",
    "identity：身份标签（如\"修仙门派弃徒\"\"地下拳手\"）",
    "faction：所属阵营或组织（可选）",
    "flaw：会在关键时刻导致失败的致命缺陷，用一句自然语言描述（如\"过度谨慎，总想收集全部信息再行动，导致多次错失时机\"）",
    "",
    "【角色关系】",
    "必须输出 relationships 数组，每对核心角色之间都要有一条关系：",
    "source/target：角色名（与上面 characters 的 name 一致）",
    "type：friend（朋友）/ enemy（敌人）/ lover（恋人）/ rival（竞争者）/ mentor（导师）/ family（家人）",
    "summary：15-30字，描述两人关系的核心冲突或纽带",
  ].join("\n");
  const descriptionText = novel.description ? `\n原始灵感/大纲：\n${novel.description.slice(0, 8000)}` : "";
  const raw = await aiInvoke({
    task: "extractor",
    systemPrompt: injectSkillRules(basePrompt, ["character","fatal_flaw"]),
    userPrompt: [`书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null, `章节：${chList}`, outline ? `大纲：${outline.slice(0, 4000)}` : null, descriptionText, "请基于以上信息生成角色阵容，不要凭空创造与大纲/灵感冲突的角色。"].filter(Boolean).join("\n"),
    schema: LLMCharExtractSchema, temperature: 0.85,
  });

  // Note: NovelCharacter/NovelCharacterRelation writes are handled by the HTTP handler
  // (DraftCharacter is the single source of truth for planning; confirm syncs to production)
  return {
    characters: raw.characters.map(c => ({ name: c.name, role: normRole(c.role), personality: c.personality, background: c.background, appearance: c.appearance ?? undefined, quirks: c.quirks ?? undefined, currentStatus: c.currentStatus ?? undefined, currentGoal: c.goal, voiceTexture: c.voice, identityLabel: c.identity, factionLabel: c.faction ?? undefined, prohibitions: c.flaw ?? undefined })),
    relationships: (raw.relationships ?? []).map(r => ({ source: r.source, target: r.target, type: r.type, summary: r.summary })),
  };
}
