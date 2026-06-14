import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { streamChapter } from "../../production/chapterWriter";
import { runQualityGate } from "../../production/qualityGate";
import { persistQualityScores } from "../../production/qualityPersist";
import { repairChapter, formatIssuesForRepair } from "../../production/repairService";
import { diagnoseWorkspace } from "../../production/revisionService";
import { optimizeChapterDraft } from "../../production/draftOptimizeService";
import { buildCharacterProhibitions } from "../../production/contextAssembler";

const router = Router();

// Generate chapter content (SSE)
router.post("/:novelId/chapters/:chapterId/write", async (req, res, next) => {
  try {
    await streamChapter(req.params.novelId, req.params.chapterId, res);
  } catch (e) { next(e); }
});

// Quality gate (non-streaming review)
router.post("/:novelId/chapters/:chapterId/review", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) { res.status(400).json({ error: { code: "NO_CONTENT", message: "Chapter has no content" } }); return; }
    const novel = await prisma.novel.findUnique({ where: { id: req.params.novelId }, select: { genre: true } });
    const characterProhibitions = await buildCharacterProhibitions(req.params.novelId).catch(() => undefined);
    const result = await runQualityGate(chapter.content, {
      genre: novel?.genre,
      characterProhibitions,
      chapterExpectation: chapter.expectation,
    });
    await persistQualityScores(chapter.id, result);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// Repair chapter
router.post("/:novelId/chapters/:chapterId/repair", async (req, res, next) => {
  try {
    const { mode, issues } = req.body;
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) { res.status(400).json({ error: { code: "NO_CONTENT" } }); return; }
    const result = await repairChapter(chapter.content, formatIssuesForRepair(issues ?? []));
    if (result && result !== chapter.content) {
      await prisma.chapter.update({ where: { id: req.params.chapterId }, data: { content: result } });
    }
    res.json({ data: { repaired: result !== chapter.content, wordCount: result.length } });
  } catch (e) { next(e); }
});

// Undo
router.post("/:novelId/chapters/:chapterId/undo", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const latestHistory = await prisma.chapterEditHistory.findFirst({
      where: { chapterId: req.params.chapterId },
      orderBy: { createdAt: "desc" },
    });
    if (!latestHistory) { res.json({ data: { restored: false, message: "无历史记录" } }); return; }
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { content: latestHistory.content, scenePlan: latestHistory.sceneState },
    });
    await prisma.chapterEditHistory.delete({ where: { id: latestHistory.id } });
    res.json({ data: { restored: true, ts: latestHistory.createdAt.toISOString(), chars: latestHistory.content.length } });
  } catch (e) { next(e); }
});

// Diagnose workspace
router.post("/:novelId/chapters/:chapterId/diagnose", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const result = await diagnoseWorkspace(req.params.novelId, req.params.chapterId);
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { diagnosis: JSON.stringify(result) },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Draft Optimize (Phase 2.8) ──────────────────────

router.post("/:novelId/chapters/:chapterId/optimize", async (req, res, next) => {
  try {
    const result = await optimizeChapterDraft(req.params.novelId, req.params.chapterId);
    // Save optimized content back to chapter
    const prisma = getPrisma();
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { content: result.optimizedContent },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

export default router;
