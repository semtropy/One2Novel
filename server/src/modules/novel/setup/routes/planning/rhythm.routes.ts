/** Phase 3: Cool point scheduling + Hook density + Rhythm reports */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getPrisma } from "../../../../../platform/db/client";
import { param } from "../../../../../platform/express/params";
import { validateVolumeRhythm } from "../../../planning/storyMacro/constraintEngine";

const router = Router();

router.get("/:novelId/volumes/:sortOrder/coolpoint-status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getCoolPointStatus } = await import("../../../production/audit/coolPointScheduler");
    const status = await getCoolPointStatus(param(req, "novelId"), parseInt(param(req, "sortOrder")));
    res.json({ data: status });
  } catch (e) { next(e); }
});

router.get("/:novelId/chapters/:chapterId/hook-check", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({
      where: { id: param(req, "chapterId") }, select: { content: true, hook: true },
    });
    if (!chapter) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const { checkChapterHook } = await import("../../../production/audit/hookDensityChecker");
    res.json({ data: checkChapterHook(chapter.content ?? "", chapter.hook) });
  } catch (e) { next(e); }
});

router.get("/:novelId/volumes/:sortOrder/hook-density", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { checkVolumeHookDensity } = await import("../../../production/audit/hookDensityChecker");
    res.json({ data: await checkVolumeHookDensity(param(req, "novelId"), parseInt(param(req, "sortOrder"))) });
  } catch (e) { next(e); }
});

router.get("/:novelId/volumes/:sortOrder/rhythm-report", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const volume = await prisma.volume.findFirst({
      where: { novelId: param(req, "novelId"), sortOrder: parseInt(param(req, "sortOrder")) },
      include: {
        chapterPlans: {
          orderBy: { chapterOrder: "asc" },
          select: {
            chapterOrder: true, chapterType: true, coolPointType: true,
            hookType: true, conflictLevel: true,
            chapter: { select: { title: true } },
          },
        },
      },
    });
    if (!volume) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    res.json({ data: validateVolumeRhythm({
      sortOrder: volume.sortOrder, title: volume.title,
      chapters: volume.chapterPlans.map(cp => ({
        order: cp.chapterOrder, chapterType: cp.chapterType,
        coolPointType: cp.coolPointType, hookType: cp.hookType,
        conflictLevel: cp.conflictLevel,
      })),
    }) });
  } catch (e) { next(e); }
});

// Aggregate expectation summary for all volumes
router.get("/:novelId/expectation-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const novelId = param(req, "novelId");
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: { expectationProfile: true },
    });
    const volumes = await prisma.volume.findMany({
      where: { novelId },
      orderBy: { sortOrder: "asc" },
      include: {
        chapterPlans: {
          orderBy: { chapterOrder: "asc" },
          select: {
            chapterOrder: true,
            coolPointType: true,
            hookType: true,
            chapterType: true,
            conflictLevel: true,
            chapter: { select: { chapterStatus: true, id: true } },
          },
        },
      },
    });

    const volumeReports = await Promise.all(
      volumes.map(async (vol) => {
        const { getCoolPointStatus } = await import("../../../production/audit/coolPointScheduler");
        const { checkVolumeHookDensity } = await import("../../../production/audit/hookDensityChecker");
        const coolStatus = await getCoolPointStatus(novelId, vol.sortOrder);
        const hookReport = await checkVolumeHookDensity(novelId, vol.sortOrder);
        const rhythmReport = validateVolumeRhythm({
          sortOrder: vol.sortOrder, title: vol.title,
          chapters: vol.chapterPlans.map(cp => ({
            order: cp.chapterOrder,
            chapterType: cp.chapterType,
            coolPointType: cp.coolPointType,
            hookType: cp.hookType,
            conflictLevel: cp.conflictLevel,
          })),
        });
        return { coolStatus, hookReport, rhythmReport };
      }),
    );

    let profile: { coolPointRecipe?: Record<string, number>; hookProfile?: Record<string, number>; payoffWindow?: number } | null = null;
    if (novel?.expectationProfile) {
      try { profile = JSON.parse(novel.expectationProfile); } catch {}
    }

    res.json({ data: { profile, volumeReports } });
  } catch (e) { next(e); }
});

export default router;
