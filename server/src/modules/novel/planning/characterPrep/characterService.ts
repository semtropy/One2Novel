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
  characters: { name: string; role: string; personality: string; background: string; appearance?: string; quirks?: string; currentStatus?: string; currentGoal: string; voiceTexture: string; identityLabel: string; factionLabel?: string; prohibitions?: string[] }[];
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
 * Persist DraftCharacter and DraftCharacterRelation records.
 * Cleans up stale drafts first, then creates new ones from the extraction result.
 */
export async function persistDraftCharacters(
  novelId: string,
  result: CharacterExtraction,
): Promise<void> {
  const prisma = getPrisma();

  // Clean old draft records for clean re-generation
  await prisma.draftCharacterRelation.deleteMany({ where: { novelId } });
  await prisma.draftCharacter.deleteMany({ where: { novelId } });

  // Create DraftCharacters
  const charNameToId: Record<string, string> = {};
  for (const c of result.characters) {
    const created = await prisma.draftCharacter.create({
      data: {
        novelId, name: c.name, role: c.role, personality: c.personality,
        background: c.background, appearance: c.appearance, quirks: c.quirks,
        currentStatus: c.currentStatus, currentGoal: c.currentGoal,
        voiceTexture: c.voiceTexture, identityLabel: c.identityLabel,
        prohibitions: JSON.stringify(c.prohibitions ?? []),
      },
    });
    charNameToId[c.name] = created.id;
  }

  // Create DraftCharacterRelations
  for (const rel of (result.relationships ?? [])) {
    const sid = charNameToId[rel.source];
    const tid = charNameToId[rel.target];
    if (sid && tid) {
      await prisma.draftCharacterRelation.create({
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
  const raw = await aiInvoke({
    assetId: "novel.character.extract", skillModules: ["character","fatal_flaw"],
    userPrompt: [`书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null, `章节：${chList}`, outline ? `大纲：${outline.slice(0, 4000)}` : null, descriptionText, "请基于以上信息生成角色阵容，不要凭空创造与大纲/灵感冲突的角色。"].filter(Boolean).join("\n"),
    schema: LLMCharExtractSchema, temperature: 0.85,
  });

  // Note: NovelCharacter/NovelCharacterRelation writes are handled by the HTTP handler
  // (DraftCharacter is the single source of truth for planning; confirm syncs to production)
  return {
    characters: raw.characters.map(c => ({ name: c.name, role: normRole(c.role), personality: c.personality, background: c.background, appearance: c.appearance ?? undefined, quirks: c.quirks ?? undefined, currentStatus: c.currentStatus ?? undefined, currentGoal: c.goal, voiceTexture: c.voice, identityLabel: c.identity, factionLabel: c.faction ?? undefined, prohibitions: c.flaw ? [c.flaw] : undefined })),
    relationships: (raw.relationships ?? []).map(r => ({ source: r.source, target: r.target, type: r.type, summary: r.summary })),
  };
}
