import { getPrisma } from "../../../platform/db/client";

/**
 * Rebuild DraftPlans and Volumes from a structuredOutline JSON string.
 * Used by quick-start and POST /blueprint.
 */
export async function rebuildBlueprintFromOutline(
  novelId: string,
  structuredOutline: string,
): Promise<void> {
  const prisma = getPrisma();
  const outline = JSON.parse(structuredOutline);

  // Delete ALL old draft plans + volumes (replace, not append)
  await prisma.draftPlan.deleteMany({ where: { volume: { novelId } } });
  await prisma.volume.deleteMany({ where: { novelId } });

  // Clean orphan Chapters (Volume CASCADE deletes VolumeChapterPlan but Chapter survives via SET NULL)
  const orphanChapters = await prisma.chapter.findMany({
    where: { novelId, volumeChapterPlans: { none: {} } },
    select: { id: true },
  });
  if (orphanChapters.length > 0) {
    await prisma.chapter.deleteMany({ where: { id: { in: orphanChapters.map(c => c.id) } } });
  }

  // Create fresh volumes + draft plans from outline
  for (const vol of (outline?.volumes ?? [])) {
    const sortOrder = vol.sortOrder ?? vol.volume ?? 1;
    const volume = await prisma.volume.create({
      data: { novelId, sortOrder, title: vol.title ?? "", summary: vol.summary ?? "" },
    });
    for (const ch of (vol.chapters ?? [])) {
      await prisma.draftPlan.create({
        data: {
          volumeId: volume.id,
          chapterOrder: ch.order ?? ch.chapter,
          title: ch.title ?? "",
          summary: ch.coreEvent ?? ch.summary ?? "",
        },
      });
    }
  }
}

/**
 * Restore draft tables (DraftPlan, DraftCharacter, DraftStorySeed) from writing tab data.
 * Used by POST /blueprint/restore.
 */
export async function restoreBlueprintFromWriting(novelId: string): Promise<void> {
  const prisma = getPrisma();

  // Restore DraftPlans from VolumeChapterPlans
  await prisma.draftPlan.deleteMany({ where: { volume: { novelId } } });
  const plans = await prisma.volumeChapterPlan.findMany({
    where: { volume: { novelId } },
    orderBy: [{ volumeId: "asc" }, { chapterOrder: "asc" }],
  });
  for (const p of plans) {
    await prisma.draftPlan.create({
      data: { volumeId: p.volumeId, chapterOrder: p.chapterOrder, title: p.title, summary: p.summary, synced: true },
    });
  }

  // Restore DraftCharacters from NovelCharacters
  await prisma.draftCharacter.deleteMany({ where: { novelId } });
  const chars = await prisma.novelCharacter.findMany({ where: { novelId } });
  for (const c of chars) {
    await prisma.draftCharacter.create({
      data: {
        novelId, name: c.name, role: c.role, personality: c.personality,
        background: c.background, appearance: c.appearance, quirks: c.quirks,
        currentGoal: c.currentGoal, voiceTexture: c.voiceTexture,
        identityLabel: c.identityLabel, prohibitions: c.prohibitions, synced: true,
      },
    });
  }

  // Restore DraftStorySeed from structuredOutline
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { structuredOutline: true },
  });
  if (novel?.structuredOutline) {
    await prisma.draftStorySeed.upsert({
      where: { novelId },
      create: { novelId, content: novel.structuredOutline, synced: true },
      update: { content: novel.structuredOutline, synced: true },
    });
  }
}
