import { Router } from "express";
import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { generateStoryCore } from "../../planning/storyCoreService";
import { generateCharacters, persistCharacters } from "../../planning/characterPrep/characterService";
import { generateChapterDynamics, compileDynamicsContext } from "../../planning/characterPrep/characterDynamicsService";
import { generateChapterExecutionContract } from "../../planning/storyMacro/chapterDetailService";
import { generateWorldRulesFromReference } from "../../world/worldReferenceService";
import { CreationPipeline } from "../../planning/creationPipeline";
import {
  getPipelineState,
  savePipelineState,
  updateStepState,
  advanceToNextStep,
  createInitialPipelineState,
  type StepName,
} from "../../planning/pipelineState";
// Phase 1-6 sub-routers
import architectureRoutes from "./planning/architecture.routes";
import rhythmRoutes from "./planning/rhythm.routes";
import referenceRoutes from "./planning/reference.routes";
import beatSheetRoutes from "./planning/beat-sheet.routes";
import auditRoutes from "./planning/audit.routes";

const router = Router();

// Mount Phase 1-6 sub-routers
router.use("/", architectureRoutes);
router.use("/", beatSheetRoutes);
router.use("/", rhythmRoutes);
router.use("/", referenceRoutes);
router.use("/", auditRoutes);

// ─── Story Core ──────────────────────────────────────

router.post("/:novelId/story-core", async (req, res, next) => {
  try { res.json({ data: await generateStoryCore(req.params.novelId) }); } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════
// 7-Step Advanced Creation Pipeline Routes
// ═══════════════════════════════════════════════════════════

// Initialize pipeline for advanced mode
router.post("/:novelId/pipeline/init", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const state = createInitialPipelineState(novelId, "advanced");
    await savePipelineState(state);
    res.json({ data: state });
  } catch (e) { next(e); }
});

// Get pipeline state
router.get("/:novelId/pipeline/state", async (req, res, next) => {
  try {
    const state = await getPipelineState(req.params.novelId);
    res.json({ data: state });
  } catch (e) { next(e); }
});

// Execute a single pipeline step
router.post("/:novelId/pipeline/step/:stepName", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const stepName = req.params.stepName as StepName;
    const pipeline = new CreationPipeline(novelId);

    let result: unknown = null;

    switch (stepName) {
      case "input":
        result = await pipeline.step1_storyCore();
        break;
      case "reference":
        result = await pipeline.step2_referenceAnalysis();
        break;
      case "architecture":
        result = await pipeline.step3_architectureConfirmation({
          architectureType: req.body?.architectureType,
          goldenFinger: req.body?.goldenFinger,
          centralQuestion: req.body?.centralQuestion,
          endingDirection: req.body?.endingDirection,
        });
        break;
      case "characters":
        result = await pipeline.step4_characterConfiguration();
        break;
      case "blueprint": {
        const mode = req.body?.mode ?? "per_volume";
        if (req.body?.skeletonOnly) {
          result = await pipeline.step5a_generateLoopSkeleton();
        } else if (req.body?.volumeOrder) {
          result = await pipeline.step5b_expandVolume(req.body.volumeOrder);
        } else {
          result = await pipeline.step5_blueprintGeneration(mode);
        }
        break;
      }
      case "calibration":
        await pipeline.step6_positioningCalibration();
        break;
      case "writing":
        await pipeline.step7_enterWriting();
        break;
      default:
        res.status(400).json({ error: { code: "INVALID_STEP", message: `Unknown step: ${stepName}` } });
        return;
    }

    await advanceToNextStep(novelId);
    const state = await getPipelineState(novelId);
    res.json({ data: { step: stepName, result, pipelineState: state } });
  } catch (e) { next(e); }
});

// Generate only the loop skeleton (step 5a, used by per-volume mode)
router.post("/:novelId/pipeline/generate-skeleton", async (req, res, next) => {
  try {
    const pipeline = new CreationPipeline(req.params.novelId);
    const skeleton = await pipeline.step5a_generateLoopSkeleton();
    res.json({ data: skeleton });
  } catch (e) { next(e); }
});

// Expand a single volume (step 5b)
router.post("/:novelId/pipeline/expand-volume/:volumeOrder", async (req, res, next) => {
  try {
    const pipeline = new CreationPipeline(req.params.novelId);
    const expanded = await pipeline.step5b_expandVolume(
      parseInt(req.params.volumeOrder),
    );
    res.json({ data: expanded });
  } catch (e) { next(e); }
});

// Generate all volumes at once (step 5 full mode)
router.post("/:novelId/pipeline/generate-all-volumes", async (req, res, next) => {
  try {
    const pipeline = new CreationPipeline(req.params.novelId);
    const result = await pipeline.step5_blueprintGeneration("full");
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Characters ──────────────────────────────────────

router.post("/:novelId/characters/generate", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const result = await generateCharacters(novelId);
    await persistCharacters(novelId, result);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Character Dynamics (Phase 2.1) ──────────────────

router.get("/:novelId/character-dynamics", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { chapterId } = req.query;
    if (!chapterId || typeof chapterId !== "string") {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "chapterId query param required" } });
      return;
    }
    const dynamics = await generateChapterDynamics(req.params.novelId, chapterId);
    res.json({ data: { dynamics, contextBlock: compileDynamicsContext(dynamics) } });
  } catch (e) { next(e); }
});

// ─── Chapter Execution Contract (Phase 2.3) ──────────

router.post("/:novelId/volumes/:volumeId/chapters/:chapterOrder/contract", async (req, res, next) => {
  try {
    const result = await generateChapterExecutionContract(
      req.params.novelId,
      req.params.volumeId,
      parseInt(req.params.chapterOrder),
    );
    // Persist to VolumeChapterPlan
    const prisma = getPrisma();
    const plan = await prisma.volumeChapterPlan.findFirst({
      where: { volumeId: req.params.volumeId, chapterOrder: parseInt(req.params.chapterOrder) },
    });
    if (plan) {
      await prisma.volumeChapterPlan.update({
        where: { id: plan.id },
        data: {
          purpose: result.purpose,
          exclusiveEvent: result.boundary,
          endingState: result.conflictType,
          mustAvoid: result.obligationContract.mustAvoid.join("；"),
        },
      });
    }
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── World Reference (Phase 2.7) ─────────────────────

router.post("/:novelId/world-rules/reference", async (req, res, next) => {
  try {
    const { description } = req.body;
    if (!description) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "description required" } }); return; }
    const rules = await generateWorldRulesFromReference(req.params.novelId, description);
    res.json({ data: rules });
  } catch (e) { next(e); }
});

export default router;
