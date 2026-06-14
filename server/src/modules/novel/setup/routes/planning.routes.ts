import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { generateStoryCore } from "../../planning/storyCoreService";
import { serializeTags } from "../../../../platform/data/tagHelpers";
import { generateBookFraming } from "../bookFraming";
import { generateCharacters, persistDraftCharacters } from "../../planning/characterPrep/characterService";
import { generateBlueprint } from "../../planning/blueprintService";
import { rebuildBlueprintFromOutline, restoreBlueprintFromWriting } from "../blueprintRebuild";
import { syncDraftPlansToWriting } from "../volumeChapterSync";
import { confirmScope, confirmAllScopes, unconfirmScope, getConfirmationStatus } from "../../planning/ConfirmationService";
import { generateChapterDynamics, compileDynamicsContext } from "../../planning/characterPrep/characterDynamicsService";
import { generateChapterExecutionContract } from "../../planning/storyMacro/chapterDetailService";
import { generateWorldRulesFromReference } from "../../world/worldReferenceService";

const router = Router();

// ─── Story Core ──────────────────────────────────────

router.post("/:novelId/story-core", async (req, res, next) => {
  try { res.json({ data: await generateStoryCore(req.params.novelId) }); } catch (e) { next(e); }
});

// ─── Quick Start ─────────────────────────────────────

router.post("/:novelId/quick-start", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    results.storyCore = await generateStoryCore(novelId);
    // Auto-confirm story seed immediately
    await confirmScope(novelId, "story_seed").catch(() => {});

    const tasks = [
      generateCharacters(novelId).then(async (result) => {
        await persistDraftCharacters(novelId, result);
        // Auto-confirm characters immediately
        await confirmScope(novelId, "characters").catch(() => {});
        results.characters = result;
      }).catch(e => { errors.push("characters: " + (e instanceof Error ? e.message : String(e))); }),
      generateBlueprint(novelId).then(async (r) => {
        results.blueprint = r;
        const prisma = getPrisma();
        const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { structuredOutline: true } });
        if (novel?.structuredOutline) {
          await rebuildBlueprintFromOutline(novelId, novel.structuredOutline);
          // Auto-confirm blueprint to writing tables
          await syncDraftPlansToWriting(novelId);
          await confirmScope(novelId, "blueprint");
        }
      }).catch(e => { errors.push("blueprint: " + (e instanceof Error ? e.message : String(e))); }),
      (async () => {
          const prisma = getPrisma();
          const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { title: true, description: true, genre: true } });
          if (novel) {
            const framing = await generateBookFraming({ title: novel.title, description: novel.description ?? undefined, genre: novel.genre ?? undefined });
            results.framing = framing;
            await prisma.novel.update({ where: { id: novelId }, data: {
              targetAudience: framing.targetAudience,
              commercialTags: serializeTags(framing.commercialTags),
              competingFeel: framing.competingFeel,
              bookSellingPoint: framing.bookSellingPoint,
              first30ChapterPromise: framing.first30ChapterPromise,
            }});
          }
        })().catch(e => { errors.push("framing: " + (e instanceof Error ? e.message : String(e))); }),
    ];

    await Promise.allSettled(tasks);
    res.json({ data: { ...results, errors: errors.length > 0 ? errors : undefined } });
  } catch (e) { next(e); }
});

// ─── Draft Story Seed ────────────────────────────────

router.put("/:novelId/draft-story-seed", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "content is required" } });
      return;
    }
    await prisma.draftStorySeed.upsert({
      where: { novelId },
      create: { novelId, content },
      update: { content, synced: false },
    });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// ─── Confirm / Unconfirm ─────────────────────────────

router.post("/:novelId/story-seed/confirm", async (req, res, next) => {
  try { await confirmScope(req.params.novelId, "story_seed"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});
router.delete("/:novelId/story-seed/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.novelId, "story_seed"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Characters ──────────────────────────────────────

router.post("/:novelId/characters/generate", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const result = await generateCharacters(novelId);
    await persistDraftCharacters(novelId, result);
    res.json({ data: result });
  } catch (e) { next(e); }
});

router.post("/:novelId/characters/confirm", async (req, res, next) => {
  try { await confirmScope(req.params.novelId, "characters"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});
router.delete("/:novelId/characters/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.novelId, "characters"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Blueprint ───────────────────────────────────────

router.post("/:novelId/blueprint/restore", async (req, res, next) => {
  try {
    await restoreBlueprintFromWriting(req.params.novelId);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.post("/:novelId/blueprint", async (req, res, next) => {
  try {
    const result = await generateBlueprint(req.params.novelId, req.body?.volumes);
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.novelId }, select: { structuredOutline: true } });
    if (novel?.structuredOutline) {
      await rebuildBlueprintFromOutline(req.params.novelId, novel.structuredOutline);
      // Auto-confirm: sync draft plans to writing tables immediately
      await syncDraftPlansToWriting(req.params.novelId);
      await confirmScope(req.params.novelId, "blueprint");
    }
    res.json({ data: result });
  } catch (e) { next(e); }
});
router.delete("/:novelId/blueprint/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.novelId, "blueprint"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Confirm All ─────────────────────────────────────

router.post("/:novelId/confirm-all", async (req, res, next) => {
  try {
    await confirmAllScopes(req.params.novelId);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});
router.get("/:novelId/confirmation-status", async (req, res, next) => {
  try {
    res.json({ data: await getConfirmationStatus(req.params.novelId) });
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
          taskSheet: JSON.stringify(result.obligationContract),
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
