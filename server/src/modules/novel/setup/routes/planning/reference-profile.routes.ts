/** ReferenceProfile CRUD — archives independent of novels */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getPrisma } from "../../../../../platform/db/client";
import { param } from "../../../../../platform/express/params";
import { AppError } from "../../../../../platform/errors/AppError";
import { z } from "zod";

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

// Create profile from uploaded file (standalone — no Novel required)
router.post("/profiles", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, content } = req.body;
    if (!name || !content) throw new AppError(400, "请提供书名和文件内容", "MISSING_FIELDS");
    if (content.length < 1000) throw new AppError(400, "文件内容太短（至少1000字）", "CONTENT_TOO_SHORT");

    const totalChapters = (content.match(/(?:^|\n)\s*(?:第[一二三四五六七八九十百千\d]+[章節节回]|Chapter\s+\d+)/gim) || []).length;

    const profile = await getPrisma().referenceProfile.create({
      data: { name, content, totalChapters: totalChapters || null },
    });
    res.status(201).json({ data: profile });
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

// Run analysis dimension on a profile (no Novel required)
router.post("/profiles/:id/analyze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getPrisma().referenceProfile.findUnique({ where: { id: param(req, "id") } });
    if (!profile?.content) throw new AppError(400, "档案无内容，请先上传文件", "NO_CONTENT");

    const { dimension } = req.body; // "architecture" | "loops" | "coolpoints" | "hooks" | "goldenFinger" | "timeline" | "writing" | "contentBeats"
    const { aiInvoke } = await import("../../../../../platform/llm/aiService");
    const { z } = await import("zod");

    // Truncate content to fit context window (~100k chars ~= 30k tokens)
    const content = profile.content.slice(0, 150000);

    let assetId: string;
    let schema: z.ZodType<any>;
    let userPrompt: string;

    switch (dimension) {
      case "architecture": {
        assetId = "reference.architecture.detect";
        schema = z.object({ architectureType: z.string(), confidence: z.number(), reasoning: z.string(), observedPatterns: z.array(z.string()) });
        userPrompt = `分析以下小说的章节片段，判断它属于哪种网文架构类型：\n\n${content.slice(0, 30000)}`;
        break;
      }
      case "hooks": {
        assetId = "reference.hook.extract";
        schema = z.object({ hookDistribution: z.record(z.string(), z.number()), avgHookStrength: z.number(), typicalHookStyle: z.string() });
        userPrompt = `分析以下小说的章节结尾钩子风格：\n\n${content.slice(0, 50000)}`;
        break;
      }
      case "goldenFinger": {
        assetId = "reference.golden-finger.extract";
        schema = z.object({ abilities: z.array(z.string()), limits: z.array(z.string()), goldenFingerName: z.string().optional() });
        userPrompt = `从以下小说内容中提取主角的金手指信息：\n\n${content.slice(0, 50000)}`;
        break;
      }
      case "timeline": {
        assetId = "reference.setting-timeline.extract";
        schema = z.array(z.object({ chapterIndex: z.number(), settingName: z.string(), description: z.string(), category: z.string() }));
        userPrompt = `提取以下小说的关键世界观设定首次揭示的章节节点：\n\n${content.slice(0, 50000)}`;
        break;
      }
      default:
        throw new AppError(400, `未知分析维度: ${dimension}`, "UNKNOWN_DIMENSION");
    }

    const result = await aiInvoke({ assetId, userPrompt, schema, temperature: 0.5 });

    // Store result on profile
    const updateData: Record<string, string> = {};
    if (dimension === "architecture") updateData.architectureType = (result as any).architectureType;
    if (dimension === "hooks") updateData.hookPatterns = JSON.stringify(result);
    if (dimension === "goldenFinger") updateData.goldenFingerBounds = JSON.stringify(result);
    if (dimension === "timeline") updateData.settingTimeline = JSON.stringify(result);

    if (Object.keys(updateData).length > 0) {
      await getPrisma().referenceProfile.update({ where: { id: param(req, "id") }, data: updateData });
    }

    res.json({ data: result });
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
