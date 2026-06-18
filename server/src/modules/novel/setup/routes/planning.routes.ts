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
// 4-Step Creation Pipeline Routes
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
      case "foundation":
        result = await pipeline.step1_foundation();
        break;
      case "architecture":
        result = await pipeline.step2_architecture({
          architectureType: req.body?.architectureType,
          goldenFinger: req.body?.goldenFinger,
          centralQuestion: req.body?.centralQuestion,
          endingDirection: req.body?.endingDirection,
        });
        break;
      case "characters":
        result = await pipeline.step3_characters();
        break;
      case "outline": {
        const mode = req.body?.mode ?? "per_volume";
        if (req.body?.skeletonOnly) {
          result = await pipeline.step4a_generateLoopSkeleton();
        } else if (req.body?.volumeOrder) {
          result = await pipeline.step4b_expandVolume(req.body.volumeOrder);
        } else {
          result = await pipeline.step4_outline(mode);
        }
        break;
      }
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
    const skeleton = await pipeline.step4a_generateLoopSkeleton();
    res.json({ data: skeleton });
  } catch (e) { next(e); }
});

// Expand a single volume (step 5b)
router.post("/:novelId/pipeline/expand-volume/:volumeOrder", async (req, res, next) => {
  try {
    const pipeline = new CreationPipeline(req.params.novelId);
    const expanded = await pipeline.step4b_expandVolume(
      parseInt(req.params.volumeOrder),
    );
    res.json({ data: expanded });
  } catch (e) { next(e); }
});

// Generate all volumes at once (step 5 full mode)
router.post("/:novelId/pipeline/generate-all-volumes", async (req, res, next) => {
  try {
    const pipeline = new CreationPipeline(req.params.novelId);
    const result = await pipeline.step4_outline("full");
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

// ─── Golden Finger AI Generation ──────────────────────

router.post("/:novelId/golden-finger/generate", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: {
        storySummary: true, centralQuestion: true, endingDirection: true,
        genre: true, architectureType: true, description: true,
        worldRules: { select: { category: true, title: true, content: true }, where: { status: "active" } },
      },
    });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }

    const { aiInvoke } = await import("../../../../platform/llm/aiService");
    const { z } = await import("zod");

    const GoldenFingerOutput = z.object({
      goldenFingerName: z.string(),
      abilities: z.array(z.string()),
      limits: z.array(z.string()),
    });

    const result = await aiInvoke({
      assetId: "novel.golden-finger.generate",
      userPrompt: [
        novel.storySummary ? `故事简介：${novel.storySummary}` : "",
        novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
        novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
        novel.genre ? `题材：${novel.genre}` : "",
        novel.architectureType ? `架构类型：${novel.architectureType}` : "",
        novel.description ? `灵感描述：${novel.description}` : "",
        novel.worldRules.length > 0 ? `世界规则：${novel.worldRules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join("\n")}` : "",
      ].filter(Boolean).join("\n"),
      schema: GoldenFingerOutput,
      temperature: 0.8,
      novelId,
    });

    // Persist to DB
    await prisma.novel.update({
      where: { id: novelId },
      data: { goldenFinger: JSON.stringify(result) },
    });

    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Power System Tree Generation ──────────────────────

router.post("/:novelId/power-system/generate", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: { storySummary: true, centralQuestion: true, endingDirection: true, genre: true, architectureType: true, tonePitch: true },
    });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }

    const { aiInvoke } = await import("../../../../platform/llm/aiService");
    const { z } = await import("zod");

    const PowerNodeSchema: z.ZodType<any> = z.lazy(() =>
      z.object({
        name: z.string(),
        breakthroughCondition: z.string(),
        abilityUpgrade: z.string(),
        children: z.array(PowerNodeSchema).default([]),
      })
    );
    const PowerSystemOutput = z.object({ levels: z.array(PowerNodeSchema) });

    const context = [
      novel.storySummary ? `故事简介：${novel.storySummary}` : "",
      novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
      novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
      novel.genre ? `题材：${novel.genre}` : "",
      novel.architectureType ? `架构类型：${novel.architectureType}` : "",
      novel.tonePitch ? `语气基调：${novel.tonePitch}` : "",
    ].filter(Boolean).join("\n");

    const result = await aiInvoke({
      assetId: "novel.power-system.generate",
      userPrompt: context,
      schema: PowerSystemOutput,
      temperature: 0.7,
      novelId,
    });

    // Persist to Novel
    await prisma.novel.update({
      where: { id: novelId },
      data: { powerSystemTree: JSON.stringify(result.levels) },
    });
    res.json({ data: result.levels });
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
