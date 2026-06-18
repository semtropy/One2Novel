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

    // Reference profile design pattern injection (Step 2 → golden finger)
    let designPatternContext = "";
    const activeProfileId = (await prisma.novel.findUnique({ where: { id: novelId }, select: { activeProfileId: true } }))?.activeProfileId;
    if (activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        try {
          const ar = JSON.parse(refProfile.analysisResult);
          const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern; // V3+V2 compat
          if (dp) {
            designPatternContext = `\n【参考书设计模式（few-shot）】\n类型：${dp.type} — ${dp.typeDescription}\n核心机制：${dp.coreMechanic}\n获取方式：${dp.acquisitionPattern}\n进化路径：${dp.evolutionPath?.join(" → ") ?? ""}\n限制策略：${dp.limitationStrategy}\n叙事融合：${dp.narrativeIntegration}`;
          }
        } catch {}
      }
    }

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
        designPatternContext,
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

// ═══════════════════════════════════════════════════════════
// Unified World Framework (serial: world rules → power system → golden finger)
// ═══════════════════════════════════════════════════════════

router.post("/:novelId/generate-world-framework", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: { storySummary:true, centralQuestion:true, endingDirection:true, genre:true, architectureType:true, tonePitch:true, activeProfileId:true },
    });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }

    const { aiInvoke } = await import("../../../../platform/llm/aiService");
    const { z } = await import("zod");

    // Build shared context
    let referenceContext = "";
    if (novel.activeProfileId) {
      const rp = await prisma.referenceProfile.findUnique({ where: { id: novel.activeProfileId }, select: { analysisResult: true } });
      if (rp?.analysisResult) {
        try {
          const ar = JSON.parse(rp.analysisResult);
          const ap = ar.architecture?.architectureProfile;
          if (ap) referenceContext += `\n【对标书架构数据】章节分布：推进${ap.chapterTypeDistribution?.advance}%/过渡${ap.chapterTypeDistribution?.transition}%/冷却${ap.chapterTypeDistribution?.cooldown}%/高潮${ap.chapterTypeDistribution?.climax}% | 每回环${ap.avgChaptersPerLoop?.avg}章 | 爽点：升级${ap.coolPointRecipe?.upgrade}%/收集${ap.coolPointRecipe?.collect}%/策略${ap.coolPointRecipe?.strategy}%`;
          const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern;
          if (dp) referenceContext += `\n【对标书金手指模式】${dp.type}：${dp.coreMechanic}`;
        } catch {}
      }
    }

    const baseContext = [
      novel.storySummary ? `故事简介：${novel.storySummary}` : "",
      novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : "",
      novel.endingDirection ? `结局方向：${novel.endingDirection}` : "",
      novel.genre ? `题材：${novel.genre}` : "",
      novel.architectureType ? `架构类型：${novel.architectureType}` : "",
      novel.tonePitch ? `语气基调：${novel.tonePitch}` : "",
      referenceContext,
    ].filter(Boolean).join("\n");

    // Step 2a: World Rules
    const worldRulesSchema = z.object({ rules: z.array(z.object({ category:z.string(),title:z.string(),content:z.string(),priority:z.number() })) });
    const worldRules = await aiInvoke({
      assetId: "world.rules.generate",
      userPrompt: [baseContext, "生成6个分类的世界规则（势力格局/力量体系/资源规则/社会结构/地理环境/历史背景），每个分类至少1条。优先参考对标书数据。",].join("\n"),
      schema: worldRulesSchema, temperature: 0.6, novelId,
    });

    // Persist world rules
    await prisma.worldRule.deleteMany({ where: { novelId } });
    for (const r of worldRules.rules) {
      await prisma.worldRule.create({ data: { novelId, category: r.category, title: r.title, content: r.content, priority: r.priority } });
    }
    const rulesSummary = worldRules.rules.map(r => `[${r.category}] ${r.title}: ${r.content}`).join("\n");

    // Step 2b: Power System Tree
    const PowerNodeSchema: z.ZodType<any> = z.lazy(() => z.object({ name:z.string(),breakthroughCondition:z.string(),abilityUpgrade:z.string(),children:z.array(PowerNodeSchema).default([]) }));
    const powerSystemSchema = z.object({ levels: z.array(PowerNodeSchema) });
    let powerSystemTree: any = null;
    try {
      const ps = await aiInvoke({
        assetId: "novel.power-system.generate",
        userPrompt: [baseContext, `世界规则：\n${rulesSummary}`, "根据以上世界规则和故事核心，设计力量体系境界树。每个境界必须有具体突破条件和能力跃迁。",].join("\n"),
        schema: powerSystemSchema, temperature: 0.7, novelId,
      });
      await prisma.novel.update({ where: { id: novelId }, data: { powerSystemTree: JSON.stringify(ps.levels) } });
      powerSystemTree = ps.levels;
    } catch (e) { console.warn("[WorldFramework] Power system generation failed", e); }

    // Step 2c: Golden Finger
    const goldenFingerSchema = z.object({ goldenFingerName:z.string(),abilities:z.array(z.string()),limits:z.array(z.string()) });
    let designPatternContext = "";
    if (novel.activeProfileId) {
      try {
        const rp = await prisma.referenceProfile.findUnique({ where: { id: novel.activeProfileId }, select: { analysisResult: true } });
        if (rp?.analysisResult) {
          const ar = JSON.parse(rp.analysisResult);
          const dp = (ar.goldenFinger || ar.goldenFingerAnalysis)?.designPattern;
          if (dp) designPatternContext = `\n【参考书设计模式（few-shot）】类型：${dp.type} — ${dp.typeDescription}\n核心机制：${dp.coreMechanic}\n获取方式：${dp.acquisitionPattern}\n进化路径：${dp.evolutionPath?.join(" → ")}\n限制策略：${dp.limitationStrategy}`;
        }
      } catch {}
    }
    const powerSummary = powerSystemTree ? `\n力量体系：${powerSystemTree.map((l:any) => l.name).join(" → ")}` : "";
    const gf = await aiInvoke({
      assetId: "novel.golden-finger.generate",
      userPrompt: [baseContext, `世界规则：\n${rulesSummary}`, powerSummary, designPatternContext, "设计金手指——它是主角在世界规则和力量体系中的例外。能力和限制必须具体可操作。",].filter(Boolean).join("\n"),
      schema: goldenFingerSchema, temperature: 0.8, novelId,
    });
    await prisma.novel.update({ where: { id: novelId }, data: { goldenFinger: JSON.stringify(gf) } });

    res.json({ data: { worldRules: worldRules.rules, powerSystemTree, goldenFinger: gf } });
  } catch (e) { next(e); }
});

export default router;
