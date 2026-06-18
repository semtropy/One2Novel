import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { getPrisma } from "../../../../platform/db/client";

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

/**
 * Persist characters directly to NovelCharacter + NovelCharacterRelation.
 * No more DraftCharacter indirection — planning IS production.
 */
export async function persistCharacters(
  novelId: string,
  result: CharacterExtraction,
): Promise<void> {
  const prisma = getPrisma();

  // Clean old records for clean re-generation
  await prisma.novelCharacterRelation.deleteMany({ where: { novelId } });
  await prisma.novelCharacter.deleteMany({ where: { novelId } });

  // Create NovelCharacters
  const charNameToId: Record<string, string> = {};
  for (const c of result.characters) {
    const created = await prisma.novelCharacter.create({
      data: {
        novelId, name: c.name, role: c.role, personality: c.personality,
        background: c.background, appearance: c.appearance, quirks: c.quirks,
        currentStatus: c.currentStatus, currentGoal: c.currentGoal,
        voiceTexture: c.voiceTexture, identityLabel: c.identityLabel,
        prohibitions: c.prohibitions ?? null,
      },
    });
    charNameToId[c.name] = created.id;
  }

  // Create NovelCharacterRelations
  for (const rel of (result.relationships ?? [])) {
    const sid = charNameToId[rel.source];
    const tid = charNameToId[rel.target];
    if (sid && tid) {
      await prisma.novelCharacterRelation.create({
        data: { novelId, sourceCharacterId: sid, targetCharacterId: tid, type: rel.type, summary: rel.summary },
      });
    }
  }
}

export async function generateCharacters(novelId: string): Promise<CharacterExtraction> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId }, include: { chapters: { orderBy: { order: "asc" }, take: 30 } } });
  if (!novel) throw new Error("Novel not found");
  const outline = novel.structuredOutline ?? "";
  const chList = novel.chapters.map(c => `第${c.order}章 ${c.title}`).join("、");

  const descriptionText = novel.description ? `\n原始灵感/大纲：\n${novel.description.slice(0, 8000)}` : "";
  // Gather architecture context to guide character generation
  let archContext = "";
  if (novel.architectureType) {
    const archLabels: Record<string, string> = {
      skill_slot: "技能栏搭配架构——需要：拥有独特技能组合的主角、提供技能/装备的导师或伙伴、验证战力的阶段性对手、触发副本事件的引路人",
      sequence_promotion: "序列晋升架构——需要：拥有信息差优势的主角、各序列线的盟友/对手、提供魔药配方/仪式线索的导师、扮演法中的情感锚点",
      case_driven: "超凡办案架构——需要：体制内身份的主角、直属上级（任务来源）、搭档/同事、阶段性案件的幕后主使、深藏不露的最终反派",
      cultivation_planning: "修真规划架构——需要：资源放大器型金手指主角、炼丹/炼器/阵法等辅修领域的导师、宗门内的竞争同门、各境界的守关者",
      hexagon_godhood: "六边形成神架构——需要：有严重短板的主角、各维度（武力/精神/势力/财富）的碾压者、可被吞噬/吞并的敌人、政治盟友与情感锚点",
      historical_transmigration: "穿越历史架构——需要：拥有前世知识差的主角、历史人物的现代版、守旧势力的代表、革命/改革的追随者、文明碰撞中的对手",
    };
    archContext = `\n【架构约束】${archLabels[novel.architectureType] ?? "自定义架构——根据灵感和故事核心设计角色阵容"}`;
  }
  if (novel.goldenFinger) {
    try {
      const gf = JSON.parse(novel.goldenFinger);
      if (gf.abilities?.length || gf.limits?.length) {
        archContext += `\n【金手指】能力：${(gf.abilities ?? []).join("、") || "未定义"}。限制：${(gf.limits ?? []).join("、") || "未定义"}。角色设计应与金手指的能力和限制形成有机互动。`;
      }
    } catch { /* ignore */ }
  }
  if (novel.loopSkeleton) {
    try {
      const skel = JSON.parse(novel.loopSkeleton);
      if (skel.totalLoops) {
        archContext += `\n【回环结构】共${skel.totalLoops}轮回环，每轮需有副本触发器、奖励来源、伏笔载体等角色分工。`;
      }
    } catch { /* ignore */ }
  }

  // Build story core context (Step 1 output → Step 3 input)
  let storyCoreContext = "";
  if (novel.storySummary) storyCoreContext += `\n【故事简介】${novel.storySummary}`;
  if (novel.centralQuestion) storyCoreContext += `\n【核心悬念】${novel.centralQuestion}`;
  if (novel.endingDirection) storyCoreContext += `\n【结局方向】${novel.endingDirection}`;
  if (novel.targetAudience) storyCoreContext += `\n【目标读者】${novel.targetAudience}`;
  if (novel.bookSellingPoint) storyCoreContext += `\n【核心卖点】${novel.bookSellingPoint}`;

  // Build world context (Step 2 output → Step 3 input)
  let worldContext = "";
  // World rules summary
  const worldRules = await prisma.worldRule.findMany({
    where: { novelId, status: "active" },
    select: { category: true, title: true, content: true },
    take: 15,
  });
  if (worldRules.length > 0) {
    worldContext += `\n【世界规则】\n${worldRules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join("\n")}`;
  }
  // Golden finger summary
  if (novel.goldenFinger) {
    try {
      const gf = JSON.parse(novel.goldenFinger);
      if (gf.goldenFingerName) worldContext += `\n【金手指】${gf.goldenFingerName}`;
      if (gf.abilities?.length) worldContext += `\n能力：${gf.abilities.join("、")}`;
      if (gf.limits?.length) worldContext += `\n限制：${gf.limits.join("、")}`;
    } catch {}
  }

  // Loop narrative context (reference book analysis → Step 3)
  let loopContext = "";
  try {
    const activeProfileId = (await prisma.novel.findUnique({ where: { id: novelId }, select: { activeProfileId: true } }))?.activeProfileId;
    if (activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        const ar = JSON.parse(refProfile.analysisResult);
        if (ar.loopNarratives?.length > 0) {
          loopContext = `\n【对标书回环角色变化】\n${ar.loopNarratives.slice(0, 8).map((l: any) => `第${l.loopIndex}轮回环：核心冲突=${l.coreConflict} | 主角变化=${l.protagonistChange} | 叙事功能=${l.narrativeFunction}`).join("\n")}`;
        }
      }
    }
  } catch {}

  const raw = await aiInvoke({
    assetId: "novel.character.extract", skillModules: ["character","fatal_flaw"],
    userPrompt: [`书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null, storyCoreContext, worldContext, loopContext, `章节：${chList}`, outline ? `大纲：${outline.slice(0, 4000)}` : null, descriptionText, archContext, "请基于以上信息生成角色阵容，确保角色在架构中承担明确的功能标签（副本触发器/奖励来源/伏笔载体/长期威胁/情感锚点），不要凭空创造与大纲/灵感冲突的角色。"].filter(Boolean).join("\n"),
    schema: LLMCharExtractSchema, temperature: 0.85,
  });

  return {
    characters: raw.characters.map(c => ({ name: c.name, role: normRole(c.role), personality: c.personality, background: c.background, appearance: c.appearance ?? undefined, quirks: c.quirks ?? undefined, currentStatus: c.currentStatus ?? undefined, currentGoal: c.goal, voiceTexture: c.voice, identityLabel: c.identity, factionLabel: c.faction ?? undefined, prohibitions: c.flaw ?? undefined })),
    relationships: (raw.relationships ?? []).map(r => ({ source: r.source, target: r.target, type: r.type, summary: r.summary })),
  };
}
