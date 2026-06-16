/** ReferenceProfile CRUD — archives independent of novels */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getPrisma } from "../../../../../platform/db/client";
import { param } from "../../../../../platform/express/params";

const router = Router();

// List all profiles
router.get("/profiles", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const profiles = await getPrisma().referenceProfile.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, architectureType: true, totalChapters: true, createdAt: true },
    });
    res.json({ data: profiles });
  } catch (e) { next(e); }
});

// Get single profile with full analysis data
router.get("/profiles/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getPrisma().referenceProfile.findUnique({ where: { id: param(req, "id") } });
    if (!profile) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } }); return; }
    res.json({ data: profile });
  } catch (e) { next(e); }
});

// Delete a profile
router.delete("/profiles/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().referenceProfile.delete({ where: { id: param(req, "id") } });
    res.status(204).send();
  } catch (e) { next(e); }
});

// Save analysis results as a profile from a reference book
router.post("/:novelId/reference-book/save-profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const rb = await prisma.referenceBook.findUnique({
      where: { novelId: param(req, "novelId") },
    });
    if (!rb) { res.status(404).json({ error: { code: "NOT_FOUND", message: "No reference book" } }); return; }

    let annotations: Record<string, unknown> = {};
    if (rb.annotations) {
      try { annotations = JSON.parse(rb.annotations); } catch { /* old format */ }
    }

    // Reconstruct from old annotations field (backward compat) + direct writingAssets
    const profile = await prisma.referenceProfile.create({
      data: {
        name: req.body.name || rb.fileName || "未命名档案",
        architectureType: (annotations.detectedArchitecture as { type: string })?.type ?? null,
        totalChapters: rb.totalChapters ?? null,
        loopBoundaries: annotations.loopBoundaries ? JSON.stringify(annotations.loopBoundaries) : null,
        coolPointDensity: JSON.stringify({
          highCoolChapters: annotations.highCoolChapters ?? [],
          lowCoolChapters: annotations.lowCoolChapters ?? [],
        }),
        hookPatterns: annotations.hookPatterns ? JSON.stringify(annotations.hookPatterns) : null,
        goldenFingerBounds: annotations.goldenFingerBounds ? JSON.stringify(annotations.goldenFingerBounds) : null,
        contentBeatPatterns: annotations.contentBeatPatterns ? JSON.stringify(annotations.contentBeatPatterns) : null,
        writingAssets: rb.writingAssets ?? null,
        settingTimeline: annotations.keySettings ? JSON.stringify(annotations.keySettings) : null,
      },
    });

    // Link reference book to profile
    await prisma.referenceBook.update({
      where: { novelId: param(req, "novelId") },
      data: { profileId: profile.id },
    });

    // Auto-set as active profile for this novel
    await prisma.novel.update({
      where: { id: param(req, "novelId") },
      data: { activeProfileId: profile.id },
    });

    res.json({ data: profile });
  } catch (e) { next(e); }
});

// Set active profile for a novel
router.put("/:novelId/active-profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getPrisma().novel.update({
      where: { id: param(req, "novelId") },
      data: { activeProfileId: req.body.profileId ?? null },
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

export default router;
