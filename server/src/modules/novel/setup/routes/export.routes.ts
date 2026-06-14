import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { exportNovel, exportPreview } from "../../export/exportService";
import { getNovelStatistics, getDailyOutput, getQualityTrend, getPayoffStats } from "../../export/statisticsService";
import { detectFormattingIssues, cleanupChapter, cleanupAllChapters } from "../../export/formatCleanup";

const router = Router();

// Export
router.get("/:novelId/export", async (req, res, next) => {
  try {
    const format = (req.query.format as string) ?? "md";
    if (!["epub", "txt", "md", "json"].includes(format)) {
      res.status(400).json({ error: { code: "INVALID_FORMAT", message: "Format must be epub, txt, md, or json" } });
      return;
    }
    const result = await exportNovel(req.params.novelId, format as "epub" | "txt" | "md" | "json");
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.fileName)}"`);
    if (Buffer.isBuffer(result.content)) {
      res.send(result.content);
    } else {
      res.send(Buffer.from(result.content, "utf-8"));
    }
  } catch (e) { next(e); }
});

router.get("/:novelId/export/preview", async (req, res, next) => {
  try { res.json({ data: await exportPreview(req.params.novelId) }); } catch (e) { next(e); }
});

// Statistics
router.get("/:novelId/statistics", async (req, res, next) => {
  try { res.json({ data: await getNovelStatistics(req.params.novelId) }); } catch (e) { next(e); }
});

router.get("/:novelId/statistics/daily", async (req, res, next) => {
  try { res.json({ data: await getDailyOutput(req.params.novelId) }); } catch (e) { next(e); }
});

router.get("/:novelId/statistics/quality", async (req, res, next) => {
  try { res.json({ data: await getQualityTrend(req.params.novelId) }); } catch (e) { next(e); }
});

router.get("/:novelId/statistics/payoffs", async (req, res, next) => {
  try { res.json({ data: await getPayoffStats(req.params.novelId) }); } catch (e) { next(e); }
});

// Cleanup / Format
router.get("/:novelId/chapters/:chapterId/format-issues", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const ch = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!ch?.content) { res.status(400).json({ error: { code: "NO_CONTENT", message: "章节没有内容" } }); return; }
    res.json({ data: detectFormattingIssues(ch.content) });
  } catch (e) { next(e); }
});

router.post("/:novelId/chapters/:chapterId/cleanup", async (req, res, next) => {
  try { res.json({ data: await cleanupChapter(req.params.chapterId) }); } catch (e) { next(e); }
});

router.post("/:novelId/cleanup", async (req, res, next) => {
  try { res.json({ data: await cleanupAllChapters(req.params.novelId) }); } catch (e) { next(e); }
});

export default router;
