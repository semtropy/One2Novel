/** Phase 4: Reference book upload, annotation, inference, statistics */
import { Router, type Request, type Response, type NextFunction } from "express";
import { param } from "../../../../../platform/express/params";
import { createReferenceBookService } from "../../../planning/referenceBookService";

const router = Router();

router.post("/:novelId/reference-book", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fileName, content } = req.body;
    if (!fileName || !content) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "fileName and content are required" } });
      return;
    }
    const service = createReferenceBookService();
    res.json({ data: await service.upload(param(req, "novelId"), fileName, content) });
  } catch (e) { next(e); }
});

router.get("/:novelId/reference-book", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = createReferenceBookService();
    const result = await service.get(param(req, "novelId"));
    if (!result) { res.status(404).json({ error: { code: "NOT_FOUND", message: "No reference book uploaded" } }); return; }
    res.json({ data: result });
  } catch (e) { next(e); }
});

router.delete("/:novelId/reference-book", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await createReferenceBookService().remove(param(req, "novelId"));
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.put("/:novelId/reference-book/annotations", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = createReferenceBookService();
    res.json({ data: await service.saveAnnotations(param(req, "novelId"), req.body.annotations) });
  } catch (e) { next(e); }
});

router.get("/:novelId/reference-book/chapters", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().getChapters(param(req, "novelId")) });
  } catch (e) { next(e); }
});

router.get("/:novelId/reference-book/chapters/:chapterIndex", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = await createReferenceBookService().getChapterContent(
      param(req, "novelId"), parseInt(param(req, "chapterIndex")));
    if (content === null) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    res.json({ data: { chapterIndex: parseInt(param(req, "chapterIndex")), content } });
  } catch (e) { next(e); }
});

router.post("/:novelId/reference-book/infer-loops", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().inferLoops(param(req, "novelId")) });
  } catch (e) { next(e); }
});

router.post("/:novelId/reference-book/infer-coolpoints", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().inferCoolPoints(param(req, "novelId")) });
  } catch (e) { next(e); }
});

router.get("/:novelId/reference-book/statistics", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().getStatistics(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 写法资产提取
router.post("/:novelId/reference-book/extract-writing-assets", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().extractWritingAssets(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 参考书架构判定
router.post("/:novelId/reference-book/detect-architecture", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().detectArchitecture(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 参考书钩子模式提取
router.post("/:novelId/reference-book/extract-hook-patterns", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().extractHookPatterns(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 参考书金手指提取
router.post("/:novelId/reference-book/extract-golden-finger", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().extractGoldenFingerBounds(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 参考书设定时间线提取
router.post("/:novelId/reference-book/extract-setting-timeline", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().extractSettingTimeline(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 内容节拍提取
router.post("/:novelId/reference-book/extract-content-beats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().extractContentBeats(param(req, "novelId")) });
  } catch (e) { next(e); }
});

// Phase: 从写法资产创建风格配置文件
router.post("/:novelId/reference-book/create-style-profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await createReferenceBookService().createStyleProfileFromAssets(param(req, "novelId")) });
  } catch (e) { next(e); }
});

export default router;
