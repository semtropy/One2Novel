/** Phase 1: Architecture templates + Loop skeleton + Volume expansion */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getPrisma } from "../../../../../platform/db/client";
import { listArchitectureTemplates, buildExpectationProfile } from "../../../planning/architectureEngine/architectureRegistry";
import { generateLoopSkeleton, expandLoopToVolume } from "../../../planning/architectureEngine/loopTemplateService";
import type { ExpandedVolume, ArchitectureType } from "../../../planning/architectureEngine/types";
import type { LoopSkeleton } from "../../../planning/architectureEngine/types";
import { param } from "../../../../../platform/express/params";

const router = Router();

const LoopSkeletonSchema = z.object({
  architectureType: z.string(),
  totalLoops: z.number().int().min(1),
  loops: z.array(z.object({
    loopIndex: z.number().int(),
    triggerEvent: z.string(),
    dungeonName: z.string(),
    estimatedChapters: z.number().int().min(6).max(25),
    settlementContent: z.string(),
    scaleUpDirection: z.string(),
  })),
  estimatedTotalChapters: z.number().int(),
});

function parseSkeleton(raw: string | null): LoopSkeleton {
  if (!raw) throw new Error("No skeleton data");
  const parsed = LoopSkeletonSchema.parse(JSON.parse(raw));
  return { ...parsed, architectureType: parsed.architectureType as ArchitectureType };
}

async function syncExpandedChapters(
  prisma: ReturnType<typeof getPrisma>,
  novelId: string, volumeId: string, sortOrder: number,
  expanded: ExpandedVolume,
) {
  let globalOrder = 0;
  for (const ch of expanded.phases.flatMap(p => p.chapters)) {
    globalOrder++;
    const existingPlan = await prisma.volumeChapterPlan.findFirst({
      where: { volumeId, chapterOrder: ch.chapterOrder },
    });
    const planData = {
      title: ch.title, summary: ch.summary,
      purpose: ch.expectation, exclusiveEvent: ch.coreEvent, endingState: ch.endingHook,
      loopPhase: ch.loopPhase, loopIndex: sortOrder,
      coolPointType: ch.coolPointType, hookType: ch.hookType, chapterType: ch.chapterType,
      contentBeat: ch.contentBeat,
    };
    if (existingPlan) {
      await prisma.volumeChapterPlan.update({ where: { id: existingPlan.id }, data: planData });
      if (existingPlan.chapterId) {
        await prisma.chapter.update({
          where: { id: existingPlan.chapterId },
          data: { title: ch.title, order: globalOrder, expectation: ch.expectation },
        });
      }
    } else {
      const chapter = await prisma.chapter.create({
        data: { novelId, order: globalOrder, title: ch.title, expectation: ch.expectation, chapterStatus: "planned" },
      });
      await prisma.volumeChapterPlan.create({
        data: { ...planData, volumeId, chapterOrder: ch.chapterOrder, chapterId: chapter.id },
      });
    }
  }
}

// Save architecture + expectation profile
router.put("/:novelId/architecture", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const data: Record<string, unknown> = {};
    if (req.body.architectureType !== undefined) data.architectureType = req.body.architectureType;
    if (req.body.goldenFinger !== undefined) data.goldenFinger = req.body.goldenFinger;
    if (req.body.centralQuestion !== undefined) data.centralQuestion = req.body.centralQuestion;
    if (req.body.endingDirection !== undefined) data.endingDirection = req.body.endingDirection;
    // Persist expectation profile from architecture template
    if (req.body.architectureType) {
      const profile = buildExpectationProfile(req.body.architectureType);
      if (profile) data.expectationProfile = profile;
    }
    const novel = await prisma.novel.update({
      where: { id: param(req, "novelId") },
      data,
    });
    res.json({ data: novel });
  } catch (e) { next(e); }
});

// Architecture templates
router.get("/:novelId/architecture/templates", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = listArchitectureTemplates().map(t => ({
      id: t.id, name: t.name, description: t.description,
      compatibleGenres: t.compatibleGenres, defaultLoop: t.defaultLoop,
      defaultCoolPointRecipe: t.defaultCoolPointRecipe,
      defaultHookProfile: t.defaultHookProfile,
      representativeWorks: t.representativeWorks,
    }));
    res.json({ data: templates });
  } catch (e) { next(e); }
});

// Save custom loop definition
router.put("/:novelId/loop-definition", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const { phases } = req.body;
    if (!Array.isArray(phases)) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "phases array required" } });
      return;
    }
    const loopDef = {
      phases: phases.map((p: { phase: string; label: string; description: string; typicalChapterCount: [number, number] }) => ({
        phase: p.phase,
        label: p.label,
        description: p.description,
        typicalChapterCount: p.typicalChapterCount,
      })),
    };
    await prisma.novel.update({
      where: { id: param(req, "novelId") },
      data: { loopDefinition: JSON.stringify(loopDef) },
    });
    res.json({ data: loopDef });
  } catch (e) { next(e); }
});

// Get loop definition (custom or default from architecture)
router.get("/:novelId/loop-definition", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: param(req, "novelId") },
      select: { loopDefinition: true, architectureType: true },
    });
    if (novel?.loopDefinition) {
      res.json({ data: JSON.parse(novel.loopDefinition) });
      return;
    }
    // Fall back to architecture default
    if (novel?.architectureType) {
      const { getArchitectureTemplate } = await import("../../../planning/architectureEngine/architectureRegistry");
      const tmpl = getArchitectureTemplate(novel.architectureType as ArchitectureType);
      if (tmpl) {
        res.json({ data: { phases: tmpl.defaultLoop.phases, source: "template" } });
        return;
      }
    }
    res.json({ data: null });
  } catch (e) { next(e); }
});

// Loop skeleton
router.post("/:novelId/loops/generate-skeleton", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { architectureType, totalLoops } = req.body;
    if (!architectureType) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "architectureType is required" } });
      return;
    }
    const skeleton = await generateLoopSkeleton({ novelId: param(req, "novelId"), architectureType, totalLoops });
    const prisma = getPrisma();
    await prisma.novel.update({
      where: { id: param(req, "novelId") },
      data: { loopSkeleton: JSON.stringify(skeleton) },
    });
    // Auto-initialize character presence for all loops
    import("../../../planning/characterPrep/characterLifecycleService").then(m => {
      Promise.all(skeleton.loops.map((_, i) =>
        m.initializeVolumePresence(param(req, "novelId"), i + 1).catch(() => {})
      )).catch(() => {});
    }).catch(() => {});
    res.json({ data: skeleton });
  } catch (e) { next(e); }
});

// Update loop skeleton (edit individual loops)
router.patch("/:novelId/loops", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: param(req, "novelId") } });
    if (!novel?.loopSkeleton) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    const skeleton: LoopSkeleton = parseSkeleton(novel.loopSkeleton);
    const { loops: updatedLoops } = req.body;
    if (!Array.isArray(updatedLoops)) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "loops array required" } });
      return;
    }
    skeleton.loops = updatedLoops;
    skeleton.estimatedTotalChapters = updatedLoops.reduce((s: number, l: LoopSkeleton["loops"][0]) => s + l.estimatedChapters, 0);
    skeleton.totalLoops = updatedLoops.length;
    await prisma.novel.update({
      where: { id: param(req, "novelId") },
      data: { loopSkeleton: JSON.stringify(skeleton) },
    });
    res.json({ data: skeleton });
  } catch (e) { next(e); }
});

router.get("/:novelId/loops", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: param(req, "novelId") } });
    if (!novel?.loopSkeleton) { res.json({ data: null }); return; }
    try {
      const skeleton = parseSkeleton(novel.loopSkeleton);
      res.json({ data: skeleton });
    } catch { res.json({ data: null }); }
  } catch (e) { next(e); }
});

// Volume expansion
router.post("/:novelId/volumes/:sortOrder/expand", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const novelId = param(req, "novelId");
    const sortOrder = parseInt(param(req, "sortOrder"));
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: novelId } });
    const skeleton = parseSkeleton(novel?.loopSkeleton ?? null);
    const expanded = await expandLoopToVolume(novelId, sortOrder, skeleton);

    const existingVol = await prisma.volume.findFirst({ where: { novelId, sortOrder } });
    const volumeId = existingVol
      ? (await prisma.volume.update({ where: { id: existingVol.id }, data: { title: expanded.title, summary: expanded.summary } })).id
      : (await prisma.volume.create({ data: { novelId, sortOrder, title: expanded.title, summary: expanded.summary } })).id;

    await syncExpandedChapters(prisma, novelId, volumeId, sortOrder, expanded);
    res.json({ data: expanded });
  } catch (e) { next(e); }
});

router.post("/:novelId/volumes/generate-next", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const novelId = param(req, "novelId");
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: novelId } });
    const skeleton = parseSkeleton(novel?.loopSkeleton ?? null);
    const existingVolumes = await prisma.volume.findMany({ where: { novelId }, orderBy: { sortOrder: "asc" } });
    const nextSortOrder = (existingVolumes[existingVolumes.length - 1]?.sortOrder ?? 0) + 1;
    if (nextSortOrder > skeleton.totalLoops) {
      res.status(400).json({ error: { code: "ALL_EXPANDED", message: "All loops have been expanded" } });
      return;
    }
    const expanded = await expandLoopToVolume(novelId, nextSortOrder, skeleton);
    const volume = await prisma.volume.create({
      data: { novelId, sortOrder: nextSortOrder, title: expanded.title, summary: expanded.summary },
    });
    await syncExpandedChapters(prisma, novelId, volume.id, nextSortOrder, expanded);
    res.json({ data: expanded });
  } catch (e) { next(e); }
});

export default router;
