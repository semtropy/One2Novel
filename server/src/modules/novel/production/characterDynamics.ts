import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { z } from "zod";

const DynamicsSchema = z.object({
  updates: z.array(z.object({
    characterName: z.string(), newGoal: z.string().optional(), newLocation: z.string().optional(),
    relationshipChanges: z.array(z.object({ targetName: z.string(), newType: z.string().optional(), changeDescription: z.string() })).optional(),
  })),
});

async function syncDynamicsToDraft(
  novelId: string,
  updates: Array<{
    characterName: string; newGoal?: string; newLocation?: string;
    relationshipChanges?: Array<{ targetName: string; newType?: string; changeDescription: string }>;
  }>,
): Promise<void> {
  const prisma = getPrisma();
  const draftChars = await prisma.draftCharacter.findMany({ where: { novelId } });

  for (const u of updates) {
    const dc = draftChars.find(d => d.name === u.characterName);
    if (!dc) continue;

    if (u.newGoal || u.newLocation) {
      const data: Record<string, string> = {};
      if (u.newGoal) data.currentGoal = u.newGoal;
      if (u.newLocation) data.currentLocation = u.newLocation;
      await prisma.draftCharacter.update({ where: { id: dc.id }, data }).catch(() => {});
    }

    if (u.relationshipChanges) {
      for (const rc of u.relationshipChanges) {
        const tgt = draftChars.find(d => d.name === rc.targetName);
        if (!tgt) continue;
        const existing = await prisma.draftCharacterRelation.findFirst({
          where: { novelId, sourceCharacterId: dc.id, targetCharacterId: tgt.id },
        });
        if (existing) {
          await prisma.draftCharacterRelation.update({
            where: { id: existing.id },
            data: { type: rc.newType || existing.type, summary: rc.changeDescription },
          }).catch(() => {});
        } else {
          await prisma.draftCharacterRelation.create({
            data: { novelId, sourceCharacterId: dc.id, targetCharacterId: tgt.id, type: rc.newType || "friend", summary: rc.changeDescription },
          }).catch(() => {});
        }
      }
    }
  }
}

export async function updateCharacterDynamics(novelId: string, chapterId: string): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) return;

  const characters = await prisma.novelCharacter.findMany({ where: { novelId } });
  if (characters.length === 0) return;

  const charList = characters.map(c => `${c.name} (${c.role})`).join(", ");

  try {
    const result = await aiInvoke({
      task: "extractor",
      systemPrompt: [
        "你是小说角色动态追踪分析师。根据最新章节内容，追踪角色状态变化和关系演变。",
        "分析维度：",
        "1. characterName：角色名（必须与出场角色列表中的名字完全一致）",
        "2. newGoal（可选）：角色的当前目标是否因本章事件而改变？",
        "3. newLocation（可选）：角色的物理位置是否移动？",
        "4. relationshipChanges（可选）：角色之间的信任度、亲密感、冲突程度是否变化？",
        "不编造正文中不存在的变化。",
      ].join("\n"),
      userPrompt: `出场角色：${charList}\n\n章节内容：\n${chapter.content.slice(0, 6000)}`,
      schema: DynamicsSchema, temperature: 0.3,
    });

    for (const update of result.updates) {
      const char = characters.find(c => c.name === update.characterName);
      if (!char) continue;
      const data: Record<string, string> = {};
      if (update.newGoal) data.currentGoal = update.newGoal;
      if (update.newLocation) data.currentLocation = update.newLocation;
      if (Object.keys(data).length > 0) await prisma.novelCharacter.update({ where: { id: char.id }, data });

      if (update.relationshipChanges) {
        for (const rel of update.relationshipChanges) {
          const target = characters.find(c => c.name === rel.targetName);
          if (!target) continue;
          const existing = await prisma.novelCharacterRelation.findFirst({
            where: { novelId, sourceCharacterId: char.id, targetCharacterId: target.id },
          });
          const relData = { novelId, sourceCharacterId: char.id, targetCharacterId: target.id, type: rel.newType ?? "friend", summary: rel.changeDescription };
          if (existing) await prisma.novelCharacterRelation.update({ where: { id: existing.id }, data: relData });
          else await prisma.novelCharacterRelation.create({ data: relData });
        }
      }
    }
    // Reverse-sync to draft tables so the relationship graph stays current
    if (result.updates.length > 0) {
      syncDynamicsToDraft(novelId, result.updates).catch(e =>
        console.error("[char dynamics sync]", e instanceof Error ? e.message : e),
      );
    }
  } catch {}
}
