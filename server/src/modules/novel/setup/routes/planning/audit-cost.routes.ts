/** Phase 5-6: Cross-volume audit + Cost management + Completion guidance */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getPrisma } from "../../../../../platform/db/client";
import { param } from "../../../../../platform/express/params";

const router = Router();

// ── Character lifecycle ────────────────────────────────

router.get("/:novelId/characters/volume-presence/:volumeOrder", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getCharacterPresence } = await import("../../../planning/characterPrep/characterLifecycleService");
    res.json({ data: await getCharacterPresence(param(req, "novelId"), parseInt(param(req, "volumeOrder"))) });
  } catch (e) { next(e); }
});

router.put("/:novelId/characters/:characterId/presence", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { setCharacterPresence } = await import("../../../planning/characterPrep/characterLifecycleService");
    const { volumeOrder, presence, trajectoryNote } = req.body;
    if (!volumeOrder || !presence) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "volumeOrder and presence required" } });
      return;
    }
    await setCharacterPresence(param(req, "novelId"), param(req, "characterId"), volumeOrder, presence, trajectoryNote);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.post("/:novelId/volumes/:sortOrder/character-schedule", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { recommendVolumeCast } = await import("../../../planning/characterPrep/characterLifecycleService");
    res.json({ data: await recommendVolumeCast(param(req, "novelId"), parseInt(param(req, "sortOrder"))) });
  } catch (e) { next(e); }
});

router.get("/:novelId/characters/long-absent", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { detectLongAbsentCharacters } = await import("../../../planning/characterPrep/characterLifecycleService");
    const threshold = parseInt(req.query.threshold as string) || 10;
    const prisma = getPrisma();
    const chapters = await prisma.chapter.findMany({
      where: { novelId: param(req, "novelId"), chapterStatus: "completed" },
      orderBy: { order: "desc" }, take: 1, select: { order: true },
    });
    const currentOrder = chapters[0]?.order ?? 0;
    res.json({ data: await detectLongAbsentCharacters(param(req, "novelId"), currentOrder, threshold) });
  } catch (e) { next(e); }
});

// ── Compression ────────────────────────────────────────

router.post("/:novelId/volumes/:sortOrder/compress", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { compressVolume } = await import("../../../production/context/tieredCompressionService");
    res.json({ data: await compressVolume(param(req, "novelId"), parseInt(param(req, "sortOrder"))) });
  } catch (e) { next(e); }
});

router.get("/:novelId/compression-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const volumes = await prisma.volume.findMany({
      where: { novelId: param(req, "novelId") }, orderBy: { sortOrder: "asc" },
      select: { sortOrder: true, title: true, summary: true },
    });
    res.json({ data: { volumes: volumes.map(v => ({ sortOrder: v.sortOrder, title: v.title, digest: v.summary ?? "" })), totalVolumes: volumes.length } });
  } catch (e) { next(e); }
});

// ── Cross-volume audit ─────────────────────────────────

router.post("/:novelId/volumes/:sortOrder/cross-audit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { auditVolume } = await import("../../../production/audit/crossVolumeAuditService");
    res.json({ data: await auditVolume(param(req, "novelId"), parseInt(param(req, "sortOrder"))) });
  } catch (e) { next(e); }
});

// ── Cost management ────────────────────────────────────

router.get("/:novelId/cost-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getCostSummary } = await import("../../../production/costTracker");
    res.json({ data: await getCostSummary(param(req, "novelId")) });
  } catch (e) { next(e); }
});

router.put("/:novelId/budget-limit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { setBudgetLimit } = await import("../../../production/costTracker");
    await setBudgetLimit(param(req, "novelId"), req.body.limit ?? null);
    res.json({ data: { ok: true, limit: req.body.limit } });
  } catch (e) { next(e); }
});

// ── Completion guidance ────────────────────────────────

router.get("/:novelId/completion-readiness", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { checkCompletionReadiness } = await import("../../../production/post/completionGuidance");
    res.json({ data: await checkCompletionReadiness(param(req, "novelId")) });
  } catch (e) { next(e); }
});

export default router;
