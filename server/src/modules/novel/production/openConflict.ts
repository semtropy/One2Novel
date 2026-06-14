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

/** Scan chapter for open conflicts, update conflict state for context injection.
 *  Cumulative tracking: reads previous chapter's open conflicts, identifies
 *  which were resolved/upgraded/new, then writes updated state. */
export async function scanConflicts(novelId: string, chapterId: string): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) return;

  try {
    const chars = await prisma.novelCharacter.findMany({ where: { novelId }, select: { name: true } });
    const charList = chars.map(c => c.name).join(", ");

    // Read previous chapter's conflicts for cumulative tracking
    const prevChapter = await prisma.chapter.findFirst({
      where: { novelId, order: { lt: chapter.order }, chapterStatus: { in: ["drafted", "completed"] } },
      orderBy: { order: "desc" },
      select: { openConflicts: true },
    });
    let prevConflictContext = "";
    if (prevChapter?.openConflicts) {
      try {
        const prev = JSON.parse(prevChapter.openConflicts);
        if (prev.conflicts?.length > 0) {
          prevConflictContext = `\n\n上一章的开放冲突（需检查是否延续/升级/解决）：\n${prev.conflicts.map((c: { title: string; status: string; description: string }) => `- [${c.status}] ${c.title}：${c.description}`).join("\n")}`;
        }
      } catch {}
    }

    const result = await aiInvoke({
      assetId: "novel.conflict.scan",
      userPrompt: `出场角色：${charList}\n\n章节内容：\n${chapter.content.slice(0, 6000)}${prevConflictContext}`,
      schema: ConflictSchema, temperature: 0.3,
    });

    // Store conflicts with cumulative tracking metadata
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { openConflicts: JSON.stringify({
        conflicts: result.conflicts,
        scannedAt: new Date().toISOString(),
        hasPrevConflicts: !!prevConflictContext,
      }) },
    });
  } catch {}
}

/** Get active conflicts for context assembly */
export async function getActiveConflicts(novelId: string): Promise<string> {
  const prisma = getPrisma();
  const recentChapters = await prisma.chapter.findMany({
    where: { novelId, chapterStatus: { in: ["drafted", "completed"] } },
    orderBy: { order: "desc" }, take: 5,
    select: { openConflicts: true },
  });

  const allConflicts: Array<{ title: string; description: string; parties: string[]; intensity: number; status: string }> = [];
  for (const ch of recentChapters) {
    try {
      const data = ch.openConflicts ? JSON.parse(ch.openConflicts) : {};
      if (data.conflicts) allConflicts.push(...data.conflicts.filter((c: { status: string }) => c.status !== "resolved"));
    } catch {}
  }

  if (allConflicts.length === 0) return "";
  return `## 开放冲突\n${allConflicts.map(c => `- [${c.status}] ${c.title}（${c.parties.join(" vs ")}，强度${c.intensity}）：${c.description}`).join("\n")}`;
}
