import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { validate } from "../validate";
import { ChapterCreateSchema, ChapterUpdateSchema } from "@one2novel/shared/types/novel";
import { reverseSyncDraftPlan, deleteDraftPlanForChapter, renumberWritingChaptersInVolume, renumberDraftChaptersInVolume, renumberGlobalChapterOrders, renumberVolumes } from "../volumeChapterSync";
import { generateBeatSheet } from "../../planning/storyMacro/beatSheetService";
import { rebalanceVolume } from "../../planning/storyMacro/rebalanceService";

const router = Router();

// ─── Create chapter (backward compat) ─────────────────

router.post("/:novelId/chapters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const input = validate(ChapterCreateSchema, req.body);
    const maxOrder = await prisma.chapter.aggregate({ where: { novelId: req.params.novelId }, _max: { order: true } });
    const chapter = await prisma.chapter.create({
      data: { ...input, novelId: req.params.novelId, order: (maxOrder._max.order ?? 0) + 1 },
    });
    res.status(201).json({ data: chapter });
  } catch (e) { next(e); }
});

// Update chapter — if title changed, reverse-sync to DraftPlan + VolumeChapterPlan
router.patch("/:novelId/chapters/:chapterId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const input = validate(ChapterUpdateSchema, req.body);
    const chapter = await prisma.chapter.update({ where: { id: req.params.chapterId }, data: input });
    if (input.title) {
      const plans = await prisma.volumeChapterPlan.findMany({ where: { chapterId: req.params.chapterId } });
      for (const p of plans) {
        await prisma.volumeChapterPlan.update({ where: { id: p.id }, data: { title: input.title } });
        await reverseSyncDraftPlan(p.volumeId, p.chapterOrder, input.title, p.summary);
      }
    }
    res.json({ data: chapter });
  } catch (e) { next(e); }
});

// Delete chapter (writing tab)
router.delete("/:novelId/chapters/:chapterId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const plans = await prisma.volumeChapterPlan.findMany({ where: { chapterId: req.params.chapterId } });
    for (const p of plans) {
      await deleteDraftPlanForChapter(p.volumeId, p.chapterOrder);
      await prisma.volumeChapterPlan.delete({ where: { id: p.id } });
    }
    await prisma.chapter.delete({ where: { id: req.params.chapterId } });
    for (const p of plans) {
      await renumberWritingChaptersInVolume(p.volumeId);
      await renumberDraftChaptersInVolume(p.volumeId);
    }
    await renumberGlobalChapterOrders(req.params.novelId);
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── Volumes (Blueprint) ─────────────────────────────

router.post("/:novelId/volumes", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const maxVol = await prisma.volume.aggregate({ where: { novelId }, _max: { sortOrder: true } });
    const sortOrder = (maxVol._max.sortOrder ?? 0) + 1;
    const volume = await prisma.volume.create({ data: { novelId, sortOrder, title: req.body.title ?? `第${sortOrder}卷` } });
    await prisma.draftPlan.create({ data: { volumeId: volume.id, chapterOrder: 1, title: "第1章", summary: "" } });
    res.status(201).json({ data: volume });
  } catch (e) { next(e); }
});

router.post("/:novelId/volumes/active", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const maxVol = await prisma.volume.aggregate({ where: { novelId }, _max: { sortOrder: true } });
    const sortOrder = (maxVol._max.sortOrder ?? 0) + 1;
    const volume = await prisma.volume.create({ data: { novelId, sortOrder, title: req.body.title ?? `第${sortOrder}卷` } });
    const maxGlobal = await prisma.chapter.aggregate({ where: { novelId }, _max: { order: true } });
    const globalOrder = (maxGlobal._max.order ?? 0) + 1;
    const chapter = await prisma.chapter.create({
      data: { novelId, order: globalOrder, title: "第1章", expectation: "", chapterStatus: "planned" },
    });
    await prisma.volumeChapterPlan.create({
      data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: 1, title: "第1章", summary: "" },
    });
    await reverseSyncDraftPlan(volume.id, 1, "第1章", "");
    res.status(201).json({ data: volume });
  } catch (e) { next(e); }
});

router.patch("/:novelId/volumes/:sortOrder", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Volume not found" } }); return; }
    res.json({ data: await prisma.volume.update({ where: { id: vol.id }, data: req.body }) });
  } catch (e) { next(e); }
});

router.delete("/:novelId/volumes/:sortOrder", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    await prisma.draftPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.volume.delete({ where: { id: vol.id } });
    await renumberVolumes(req.params.novelId);
    res.status(204).send();
  } catch (e) { next(e); }
});

router.delete("/:novelId/volumes/:sortOrder/writing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const plans = await prisma.volumeChapterPlan.findMany({ where: { volumeId: vol.id } });
    for (const p of plans) { if (p.chapterId) await prisma.chapter.delete({ where: { id: p.chapterId } }).catch(() => {}); }
    await prisma.volumeChapterPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.draftPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.volume.delete({ where: { id: vol.id } });
    await renumberVolumes(req.params.novelId);
    await renumberGlobalChapterOrders(req.params.novelId);
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── Volume Chapters ─────────────────────────────────

router.post("/:novelId/volumes/:sortOrder/chapters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { sortOrder } = req.params;
    const volume = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(sortOrder) } });
    if (!volume) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Volume not found" } }); return; }
    const maxPlan = await prisma.draftPlan.findFirst({ where: { volumeId: volume.id }, orderBy: { chapterOrder: "desc" } });
    const nextOrder = (maxPlan?.chapterOrder ?? 0) + 1;
    const plan = await prisma.draftPlan.create({
      data: { volumeId: volume.id, chapterOrder: nextOrder, title: req.body.title ?? `第${nextOrder}章`, summary: req.body.summary ?? "" },
    });
    await renumberDraftChaptersInVolume(volume.id);
    res.status(201).json({ data: plan });
  } catch (e) { next(e); }
});

router.post("/:novelId/volumes/:sortOrder/chapters/writing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { sortOrder } = req.params;
    const volume = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(sortOrder) } });
    if (!volume) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Volume not found" } }); return; }
    const maxPlan = await prisma.volumeChapterPlan.findFirst({ where: { volumeId: volume.id }, orderBy: { chapterOrder: "desc" } });
    const nextOrder = (maxPlan?.chapterOrder ?? 0) + 1;
    const maxGlobal = await prisma.chapter.aggregate({ where: { novelId: req.params.novelId }, _max: { order: true } });
    const globalOrder = (maxGlobal._max.order ?? 0) + 1;
    const chapter = await prisma.chapter.create({
      data: { novelId: req.params.novelId, order: globalOrder, title: req.body.title ?? `第${globalOrder}章`, expectation: req.body.summary ?? "", chapterStatus: "planned" },
    });
    await prisma.volumeChapterPlan.create({
      data: { volumeId: volume.id, chapterId: chapter.id, chapterOrder: nextOrder, title: chapter.title, summary: req.body.summary ?? "" },
    });
    await reverseSyncDraftPlan(volume.id, nextOrder, chapter.title, req.body.summary ?? null);
    await renumberWritingChaptersInVolume(volume.id);
    await renumberDraftChaptersInVolume(volume.id);
    await renumberGlobalChapterOrders(req.params.novelId);
    res.status(201).json({ data: chapter });
  } catch (e) { next(e); }
});

router.patch("/:novelId/volumes/:sortOrder/chapters/:planId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { title, summary } = req.body;
    res.json({ data: await prisma.draftPlan.update({ where: { id: req.params.planId }, data: { title, summary, synced: false } }) });
  } catch (e) { next(e); }
});

router.delete("/:novelId/volumes/:sortOrder/chapters/:planId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const dp = await prisma.draftPlan.findUnique({ where: { id: req.params.planId } });
    if (!dp) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    await prisma.draftPlan.delete({ where: { id: req.params.planId } });
    await renumberDraftChaptersInVolume(dp.volumeId);
    res.status(204).send();
  } catch (e) { next(e); }
});

router.delete("/:novelId/volumes/:sortOrder/chapters/writing/:planId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const plan = await prisma.volumeChapterPlan.findUnique({ where: { id: req.params.planId }, include: { volume: true } });
    if (!plan) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    if (plan.chapterId) { await prisma.chapter.delete({ where: { id: plan.chapterId } }); }
    await prisma.volumeChapterPlan.delete({ where: { id: plan.id } });
    await deleteDraftPlanForChapter(plan.volumeId, plan.chapterOrder);
    await renumberWritingChaptersInVolume(plan.volumeId);
    await renumberDraftChaptersInVolume(plan.volumeId);
    await renumberGlobalChapterOrders(req.params.novelId);
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── Beat Sheet (Phase 2.4) ──────────────────────────

router.post("/:novelId/volumes/:sortOrder/beat-sheet", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const sheet = await generateBeatSheet(req.params.novelId, vol.id);
    res.json({ data: sheet });
  } catch (e) { next(e); }
});

// ─── Volume Rebalance (Phase 2.5) ─────────────────────

router.post("/:novelId/volumes/:sortOrder/rebalance", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findFirst({ where: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const result = await rebalanceVolume(req.params.novelId, vol.id);
    // Mark adjusted chapters as unsynced to flag for review
    for (const adj of result.adjustedChapters) {
      const dp = await prisma.draftPlan.findFirst({ where: { volumeId: vol.id, chapterOrder: adj.chapterOrder } });
      if (dp && adj.changes) {
        await prisma.draftPlan.update({ where: { id: dp.id }, data: { synced: false } });
      }
    }
    res.json({ data: result });
  } catch (e) { next(e); }
});

export default router;
