import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { z } from "zod";

const ConflictSchema = z.object({
  conflicts: z.array(z.object({
    title: z.string(),
    description: z.string(),
    parties: z.array(z.string()),
    intensity: z.number().int().min(1).max(10),
    status: z.string(),
  })),
});

/** Scan chapter for open conflicts, update conflict state for context injection */
export async function scanConflicts(novelId: string, chapterId: string): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) return;

  try {
    const chars = await prisma.novelCharacter.findMany({ where: { novelId }, select: { name: true } });
    const charList = chars.map(c => c.name).join(", ");

    const result = await aiInvoke({
      task: "extractor",
      systemPrompt: `从章节中识别所有开放冲突（未解决的矛盾/对抗/竞争）。`,
      userPrompt: `出场角色：${charList}\n\n章节内容：\n${chapter.content.slice(0, 6000)}`,
      schema: ConflictSchema, temperature: 0.3,
    });

    // Store conflicts in chapter metadata
    const existing = chapter.sceneCards ? (() => { try { return JSON.parse(chapter.sceneCards); } catch { return {}; } })() : {};
    existing.conflicts = result.conflicts;
    await prisma.chapter.update({ where: { id: chapterId }, data: { sceneCards: JSON.stringify(existing) } });
  } catch {}
}

/** Get active conflicts for context assembly */
export async function getActiveConflicts(novelId: string): Promise<string> {
  const prisma = getPrisma();
  const recentChapters = await prisma.chapter.findMany({
    where: { novelId, chapterStatus: { in: ["drafted", "completed"] } },
    orderBy: { order: "desc" }, take: 5,
    select: { sceneCards: true },
  });

  const allConflicts: Array<{ title: string; description: string; parties: string[]; intensity: number; status: string }> = [];
  for (const ch of recentChapters) {
    try {
      const data = ch.sceneCards ? JSON.parse(ch.sceneCards) : {};
      if (data.conflicts) allConflicts.push(...data.conflicts.filter((c: { status: string }) => c.status !== "resolved"));
    } catch {}
  }

  if (allConflicts.length === 0) return "";
  return `## 开放冲突\n${allConflicts.map(c => `- [${c.status}] ${c.title}（${c.parties.join(" vs ")}，强度${c.intensity}）：${c.description}`).join("\n")}`;
}
