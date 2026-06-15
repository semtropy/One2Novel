import { getPrisma } from "../../../platform/db/client";

// ─── Renumbering utilities ────────────────────────────────

/** Renumber Volume.sortOrder for a novel: 1, 2, 3... consecutive */
export async function renumberVolumes(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
  });
  for (let i = 0; i < volumes.length; i++) {
    if (volumes[i].sortOrder !== i + 1) {
      await prisma.volume.update({
        where: { id: volumes[i].id },
        data: { sortOrder: i + 1 },
      });
    }
  }
}

/** Renumber VolumeChapterPlan.chapterOrder within a volume: 1, 2, 3... consecutive */
export async function renumberWritingChaptersInVolume(volumeId: string): Promise<void> {
  const prisma = getPrisma();
  const plans = await prisma.volumeChapterPlan.findMany({
    where: { volumeId },
    orderBy: { chapterOrder: "asc" },
  });
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].chapterOrder !== i + 1) {
      await prisma.volumeChapterPlan.update({
        where: { id: plans[i].id },
        data: { chapterOrder: i + 1 },
      });
    }
  }
}

/** Renumber all Chapter.order globally: 1, 2, 3... across all volumes in sequence */
export async function renumberGlobalChapterOrders(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const plans = await prisma.volumeChapterPlan.findMany({
    where: { volume: { novelId } },
    include: { volume: true },
    orderBy: [{ volume: { sortOrder: "asc" } }, { chapterOrder: "asc" }],
  });
  let globalOrder = 0;
  for (const plan of plans) {
    if (!plan.chapterId) continue;
    globalOrder++;
    const chapter = await prisma.chapter.findUnique({ where: { id: plan.chapterId } });
    if (chapter && chapter.order !== globalOrder) {
      await prisma.chapter.update({
        where: { id: plan.chapterId },
        data: { order: globalOrder },
      });
    }
  }
}
