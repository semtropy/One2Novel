import { getPrisma } from "../../../platform/db/client";

// ─── Renumbering ──────────────────────────────────────────

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

/** Renumber DraftPlan.chapterOrder within a volume: 1, 2, 3... consecutive */
export async function renumberDraftChaptersInVolume(volumeId: string): Promise<void> {
  const prisma = getPrisma();
  const plans = await prisma.draftPlan.findMany({
    where: { volumeId },
    orderBy: { chapterOrder: "asc" },
  });
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].chapterOrder !== i + 1) {
      await prisma.draftPlan.update({
        where: { id: plans[i].id },
        data: { chapterOrder: i + 1 },
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
  // Order chapters by Volume.sortOrder → VolumeChapterPlan.chapterOrder
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

// ─── DraftPlan ↔ Writing sync helpers ─────────────────────

/**
 * Reverse sync: when writing area creates/updates a chapter,
 * ensure a corresponding DraftPlan exists (synced=true).
 */
export async function reverseSyncDraftPlan(
  volumeId: string,
  chapterOrder: number,
  title: string,
  summary?: string | null,
): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.draftPlan.findFirst({
    where: { volumeId, chapterOrder },
  });
  if (existing) {
    await prisma.draftPlan.update({
      where: { id: existing.id },
      data: { title, summary: summary ?? existing.summary, synced: true },
    });
  } else {
    await prisma.draftPlan.create({
      data: { volumeId, chapterOrder, title, summary: summary ?? "", synced: true },
    });
  }
}

/** Delete the DraftPlan matching a writing-area chapter (by volumeId + chapterOrder) */
export async function deleteDraftPlanForChapter(
  volumeId: string,
  chapterOrder: number,
): Promise<void> {
  const prisma = getPrisma();
  const dp = await prisma.draftPlan.findFirst({ where: { volumeId, chapterOrder } });
  if (dp) {
    await prisma.draftPlan.delete({ where: { id: dp.id } });
  }
}

// ─── Core Confirm: DraftPlan → Writing ────────────────────

/**
 * Sync all DraftPlans for a novel to the writing area (Chapter + VolumeChapterPlan).
 * - Upserts: DraftPlan → VolumeChapterPlan + Chapter (title/summary only, never touches content)
 * - Deletes: VolumeChapterPlans that no longer have a DraftPlan
 * - Deletes: empty Volumes (no VolumeChapterPlans left)
 * - Renumbers: Volume.sortOrder, per-volume chapterOrder, global Chapter.order
 */
export async function syncDraftPlansToWriting(
  novelId: string,
  opts?: { mode?: "replace" | "merge" },
): Promise<void> {
  const prisma = getPrisma();
  const mode = opts?.mode ?? "replace";

  // 0. Clean orphan Chapters — those that lost their VolumeChapterPlan
  //    (Volume CASCADE deletes VolumeChapterPlan, but Chapter survives via SET NULL)
  const orphanChapters = await prisma.chapter.findMany({
    where: { novelId, volumeChapterPlans: { none: {} } },
    select: { id: true },
  });
  if (orphanChapters.length > 0) {
    await prisma.chapter.deleteMany({
      where: { id: { in: orphanChapters.map(c => c.id) } },
    });
  }

  // 1. Upsert: for each DraftPlan, ensure a VolumeChapterPlan (and Chapter) exists
  const draftPlans = await prisma.draftPlan.findMany({
    where: { volume: { novelId } },
    include: { volume: true },
    orderBy: [{ volumeId: "asc" }, { chapterOrder: "asc" }],
  });

  // Track which (volumeId, chapterOrder) pairs exist in DraftPlan
  const draftKeys = new Set(draftPlans.map((dp) => `${dp.volumeId}:${dp.chapterOrder}`));

  // Start global order after last existing chapter
  const maxOrderResult = await prisma.chapter.aggregate({ where: { novelId }, _max: { order: true } });
  let globalOrder = maxOrderResult._max.order ?? 0;
  for (const dp of draftPlans) {
    globalOrder++;
    const existingPlan = await prisma.volumeChapterPlan.findFirst({
      where: { volumeId: dp.volumeId, chapterOrder: dp.chapterOrder },
    });

    if (existingPlan) {
      // Update title/summary (never content)
      await prisma.volumeChapterPlan.update({
        where: { id: existingPlan.id },
        data: { title: dp.title, summary: dp.summary },
      });
      if (existingPlan.chapterId) {
        await prisma.chapter.update({
          where: { id: existingPlan.chapterId },
          data: { title: dp.title, order: globalOrder },
        });
      }
    } else {
      // Create new Chapter + VolumeChapterPlan
      const chapter = await prisma.chapter.create({
        data: {
          novelId,
          order: globalOrder,
          title: dp.title,
          expectation: dp.summary ?? "",
          chapterStatus: "planned",
        },
      });
      await prisma.volumeChapterPlan.create({
        data: {
          volumeId: dp.volumeId,
          chapterOrder: dp.chapterOrder,
          title: dp.title,
          summary: dp.summary,
          chapterId: chapter.id,
        },
      });
    }

    // Mark as synced
    await prisma.draftPlan.update({
      where: { id: dp.id },
      data: { synced: true },
    });
  }

  // 2. Delete: VolumeChapterPlans that no longer have a DraftPlan (replace mode only)
  if (mode === "replace") {
    const allWritingPlans = await prisma.volumeChapterPlan.findMany({
      where: { volume: { novelId } },
    });
    for (const wp of allWritingPlans) {
      if (!draftKeys.has(`${wp.volumeId}:${wp.chapterOrder}`)) {
        // Delete the Chapter first
        if (wp.chapterId) {
          await prisma.chapter.delete({ where: { id: wp.chapterId } }).catch(() => {});
        }
        await prisma.volumeChapterPlan.delete({ where: { id: wp.id } });
      }
    }

    // 3. Delete empty Volumes (no VolumeChapterPlans left) — replace mode only
    const allVolumes = await prisma.volume.findMany({
      where: { novelId },
      include: { chapterPlans: { select: { id: true } } },
    });
    for (const vol of allVolumes) {
      if (vol.chapterPlans.length === 0) {
        // Also delete any orphaned DraftPlans
        await prisma.draftPlan.deleteMany({ where: { volumeId: vol.id } });
        await prisma.volume.delete({ where: { id: vol.id } });
      }
    }
  }

  // 4. Renumber everything
  await renumberVolumes(novelId);
  // Renumber per-volume chapterOrders for all remaining volumes
  const remainingVols = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
  });
  for (const vol of remainingVols) {
    await renumberWritingChaptersInVolume(vol.id);
    await renumberDraftChaptersInVolume(vol.id);
  }
  await renumberGlobalChapterOrders(novelId);
}

// ─── Draft Character / Relation sync helpers ──────────────

/**
 * Sync DraftCharacters → NovelCharacters (upsert + delete orphans).
 * Marks all surviving DraftCharacters as synced=true.
 */
export async function syncDraftCharactersToWriting(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const draftChars = await prisma.draftCharacter.findMany({ where: { novelId } });
  const draftCharNames = new Set(draftChars.map(dc => dc.name));

  for (const dc of draftChars) {
    const existing = await prisma.novelCharacter.findFirst({ where: { novelId, name: dc.name } });
    if (existing) {
      await prisma.novelCharacter.update({
        where: { id: existing.id },
        data: {
          role: dc.role, personality: dc.personality, background: dc.background,
          appearance: dc.appearance, quirks: dc.quirks, currentStatus: dc.currentStatus,
          currentGoal: dc.currentGoal, voiceTexture: dc.voiceTexture,
          identityLabel: dc.identityLabel, prohibitions: dc.prohibitions,
        },
      });
    } else {
      await prisma.novelCharacter.create({
        data: {
          novelId, name: dc.name, role: dc.role, personality: dc.personality,
          background: dc.background, appearance: dc.appearance, quirks: dc.quirks,
          currentStatus: dc.currentStatus, currentGoal: dc.currentGoal,
          voiceTexture: dc.voiceTexture, identityLabel: dc.identityLabel,
          prohibitions: dc.prohibitions,
        },
      });
    }
    await prisma.draftCharacter.update({ where: { id: dc.id }, data: { synced: true } });
  }

  // Delete NovelCharacters that no longer exist in DraftCharacter
  const novelChars = await prisma.novelCharacter.findMany({ where: { novelId } });
  for (const nc of novelChars) {
    if (!draftCharNames.has(nc.name)) {
      await prisma.novelCharacterRelation.deleteMany({
        where: { OR: [{ sourceCharacterId: nc.id }, { targetCharacterId: nc.id }] },
      });
      await prisma.novelCharacter.delete({ where: { id: nc.id } });
    }
  }
}

/**
 * Sync DraftCharacterRelations → NovelCharacterRelations (upsert + delete orphans).
 * Requires DraftCharacters to be synced first (maps DraftChar IDs → NovelChar IDs by name).
 * Marks all surviving DraftCharacterRelations as synced=true.
 */
export async function syncDraftRelationsToWriting(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const draftChars = await prisma.draftCharacter.findMany({ where: { novelId } });
  const draftRels = await prisma.draftCharacterRelation.findMany({ where: { novelId } });
  const draftRelKeys = new Set(draftRels.map(r => `${r.sourceCharacterId}:${r.targetCharacterId}`));

  // Map DraftCharacter IDs → NovelCharacter IDs (both reference the same name)
  const dcIdToNcId: Record<string, string> = {};
  for (const dc of draftChars) {
    const nc = await prisma.novelCharacter.findFirst({ where: { novelId, name: dc.name } });
    if (nc) dcIdToNcId[dc.id] = nc.id;
  }

  for (const dr of draftRels) {
    const srcNcId = dcIdToNcId[dr.sourceCharacterId];
    const tgtNcId = dcIdToNcId[dr.targetCharacterId];
    if (!srcNcId || !tgtNcId) continue;
    const existingRel = await prisma.novelCharacterRelation.findFirst({
      where: { novelId, sourceCharacterId: srcNcId, targetCharacterId: tgtNcId },
    });
    if (existingRel) {
      await prisma.novelCharacterRelation.update({
        where: { id: existingRel.id },
        data: { type: dr.type, summary: dr.summary },
      });
    } else {
      await prisma.novelCharacterRelation.create({
        data: { novelId, sourceCharacterId: srcNcId, targetCharacterId: tgtNcId, type: dr.type, summary: dr.summary },
      });
    }
    await prisma.draftCharacterRelation.update({ where: { id: dr.id }, data: { synced: true } });
  }

  // Delete NovelCharacterRelations that no longer exist in DraftCharacterRelation
  const novelRels = await prisma.novelCharacterRelation.findMany({ where: { novelId } });
  for (const nr of novelRels) {
    if (!draftRelKeys.has(`${nr.sourceCharacterId}:${nr.targetCharacterId}`)) {
      await prisma.novelCharacterRelation.delete({ where: { id: nr.id } });
    }
  }
}
