import { getPrisma } from "../../../platform/db/client";

/**
 * Rebuild Volumes + VolumeChapterPlans + Chapters from a structuredOutline JSON string.
 * Used by quick-start and POST /blueprint.
 * Since Draft tables are removed, this writes directly to production tables.
 */
export async function rebuildBlueprintFromOutline(
  novelId: string,
  structuredOutline: string,
): Promise<void> {
  const prisma = getPrisma();
  const outline = JSON.parse(structuredOutline);

  // Clear existing volumes (CASCADE deletes VolumeChapterPlans)
  await prisma.volume.deleteMany({ where: { novelId } });

  // Clean orphan Chapters (Volume CASCADE deletes VolumeChapterPlan but Chapter survives via SET NULL)
  const orphanChapters = await prisma.chapter.findMany({
    where: { novelId, volumeChapterPlans: { none: {} } },
    select: { id: true },
  });
  if (orphanChapters.length > 0) {
    await prisma.chapter.deleteMany({ where: { id: { in: orphanChapters.map(c => c.id) } } });
  }

  // Create fresh volumes + volume chapter plans + chapters from outline
  let globalOrder = 0;
  for (const vol of (outline?.volumes ?? [])) {
    const sortOrder = vol.sortOrder ?? vol.volume ?? 1;
    const volume = await prisma.volume.create({
      data: { novelId, sortOrder, title: vol.title ?? "", summary: vol.summary ?? "" },
    });
    for (const ch of (vol.chapters ?? [])) {
      globalOrder++;
      const chapter = await prisma.chapter.create({
        data: {
          novelId,
          order: globalOrder,
          title: ch.title ?? "",
          expectation: ch.coreEvent ?? ch.summary ?? "",
          hook: ch.hook ?? "",
          chapterStatus: "planned",
        },
      });
      await prisma.volumeChapterPlan.create({
        data: {
          volumeId: volume.id,
          chapterOrder: ch.order ?? ch.chapter ?? globalOrder,
          title: ch.title ?? "",
          summary: ch.coreEvent ?? ch.summary ?? "",
          chapterId: chapter.id,
        },
      });
    }
  }
}

/**
 * Restore planning data from writing tables — since Draft tables are removed,
 * this is a no-op (the writing tables ARE the planning tables now).
 * Kept for backward compatibility with the endpoint.
 */
export async function restoreBlueprintFromWriting(_novelId: string): Promise<void> {
  // No-op: with unified model, writing tables are the source of truth.
  // The frontend can simply re-fetch novel data.
}
