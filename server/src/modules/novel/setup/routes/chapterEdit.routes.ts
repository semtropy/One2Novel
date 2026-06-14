import { Router } from "express";
import { generateScenePlan, getScenePlan, updateScenePlan, toggleScenePlan } from "../../production/scenePlanService";
import { generateRewriteCandidates, applyRevision } from "../../production/revisionService";

const router = Router();

// ─── Storyboard (Phase 14) ───────────────────────────

router.get("/:novelId/chapters/:chapterId/scenes", async (req, res, next) => {
  try {
    const plan = await getScenePlan(req.params.novelId, req.params.chapterId);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

router.post("/:novelId/chapters/:chapterId/scenes/generate", async (req, res, next) => {
  try {
    const plan = await generateScenePlan(req.params.novelId, req.params.chapterId);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

router.put("/:novelId/chapters/:chapterId/scenes", async (req, res, next) => {
  try {
    const { scenes } = req.body;
    if (!Array.isArray(scenes)) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "scenes array required" } });
      return;
    }
    const plan = await updateScenePlan(req.params.novelId, req.params.chapterId, scenes);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

router.patch("/:novelId/chapters/:chapterId/scenes/toggle", async (req, res, next) => {
  try {
    const result = await toggleScenePlan(req.params.novelId, req.params.chapterId, req.body.enabled !== false);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Revision Candidates ─────────────────────────────

router.post("/:novelId/chapters/:chapterId/revision/candidates", async (req, res, next) => {
  try {
    const { operation, selectedParagraphs, customInstruction } = req.body;
    if (!operation || !selectedParagraphs?.length) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "operation + selectedParagraphs required" } });
      return;
    }
    res.json({
      data: await generateRewriteCandidates({
        novelId: req.params.novelId,
        chapterId: req.params.chapterId,
        operation,
        selectedParagraphs,
        customInstruction,
      }),
    });
  } catch (e) { next(e); }
});

router.post("/:novelId/chapters/:chapterId/revision/apply", async (req, res, next) => {
  try {
    const { selectedParagraphs, replacementText } = req.body;
    const result = await applyRevision(req.params.chapterId, selectedParagraphs, replacementText);
    res.json({ data: result });
  } catch (e) { next(e); }
});

export default router;
