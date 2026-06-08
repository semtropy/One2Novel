import { Router } from "express";
import { getPrisma } from "../../../platform/db/client";
import type { NovelCreate, NovelUpdate, ChapterCreate, ChapterUpdate, LockScope } from "@one2novel/shared";
import { NovelCreateSchema, NovelUpdateSchema, ChapterCreateSchema, ChapterUpdateSchema, NovelCharacterCreateSchema } from "@one2novel/shared/types/novel";
import type { ZodType } from "zod";

/** C2: Runtime Zod validation — returns 400 on failure instead of 500 from DB constraint */
function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map(i => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
    throw Object.assign(new Error(`Validation failed: ${details}`), { statusCode: 400, code: "VALIDATION_ERROR" });
  }
  return result.data;
}
import { generateBookFraming } from "./bookFraming";
import { generateOutline } from "../planning/storyMacro/outlineService";
import { syncDraftPlansToWriting, reverseSyncDraftPlan, deleteDraftPlanForChapter, renumberWritingChaptersInVolume, renumberDraftChaptersInVolume, renumberGlobalChapterOrders, renumberVolumes } from "./volumeChapterSync";
import { generateCharacters } from "../planning/characterPrep/characterService";
import { streamChapter } from "../production/chapterWriter";
import { runQualityGate } from "../production/qualityGate";
import { repairChapter } from "../production/repairService";
import { generateTitles } from "./titleService";
import { generateStoryCore } from "../planning/storyCoreService";
import { generateEditorialInfo } from "../planning/editorialInfoService";
import { generateBlueprint } from "../planning/blueprintService";
import { confirmScope, confirmAllScopes, unconfirmScope, getConfirmationStatus } from "../planning/ConfirmationService";
import { getPreferences, recordCreation } from "../../settings/preferences";

export const novelRoutes = Router();

// List all novels
novelRoutes.get("/", async (_req, res, next) => {
  try {
    const prisma = getPrisma();
    const novels = await prisma.novel.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        genre: true,
        status: true,
        projectStatus: true,
        updatedAt: true,
      },
    });
    res.json({ data: novels });
  } catch (e) { next(e); }
});

// Create novel
novelRoutes.post("/", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const body = validate(NovelCreateSchema, req.body);
    // Auto-fill defaults from user preferences
    const prefs = getPreferences().preferences;
    const novel = await prisma.novel.create({
      data: {
        ...body,
        narrativePov: (body.narrativePov || prefs.preferredPerspective || "third_person") as "first_person" | "third_person" | "mixed",
        pacePreference: body.pacePreference || (prefs.preferredPace || "balanced"),
        styleTone: body.styleTone || prefs.preferredTone || null,
        genre: body.genre ?? (prefs.favoriteGenres?.[0] ?? null),
        defaultChapterLength: body.defaultChapterLength ?? prefs.defaultChapterLength ?? 3000,
        estimatedChapterCount: body.estimatedChapterCount ?? prefs.typicalChapterCount ?? null,
      },
    });
    // Record creation for recent history
    recordCreation({ title: novel.title, genre: novel.genre ?? undefined, createdAt: novel.createdAt });
    res.status(201).json({ data: novel });
  } catch (e) { next(e); }
});

// Get single novel
novelRoutes.get("/:id", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: req.params.id },
      include: {
        chapters: { orderBy: { order: "asc" } },
        characters: { orderBy: { name: "asc" } },
        draftCharacters: { orderBy: { name: "asc" } },
        draftStorySeed: true,
        timelineItems: { orderBy: { sortOrder: "asc" }, take: 20 },
        volumes: { orderBy: { sortOrder: "asc" }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" } }, draftPlans: { orderBy: { chapterOrder: "asc" } } } },
      },
    });
    if (!novel) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "小说不存在" } });
      return;
    }
    res.json({ data: novel });
  } catch (e) { next(e); }
});

// Update novel
novelRoutes.patch("/:id", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const body = validate(NovelUpdateSchema, req.body);
    const novel = await prisma.novel.update({ where: { id: req.params.id }, data: body });
    res.json({ data: novel });
  } catch (e) { next(e); }
});

// Delete novel
novelRoutes.delete("/:id", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    await prisma.novel.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) { next(e); }
});

// Generate titles
novelRoutes.post("/:id/titles", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.id } });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "不存在" } }); return; }
    const result = await generateTitles({ description: novel.description ?? undefined, genre: novel.genre ?? undefined });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// Generate book framing
novelRoutes.post("/:id/framing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.id } });
    if (!novel) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "小说不存在" } });
      return;
    }

    const framing = await generateBookFraming({
      title: novel.title,
      description: novel.description ?? undefined,
      genre: novel.genre ?? undefined,
    });

    await prisma.novel.update({
      where: { id: novel.id },
      data: {
        targetAudience: framing.targetAudience,
        commercialTags: JSON.stringify(framing.commercialTags),
        competingFeel: framing.competingFeel,
        bookSellingPoint: framing.bookSellingPoint,
        first30ChapterPromise: framing.first30ChapterPromise, genre: framing.genre ?? novel.genre, narrativePov: (framing.narrativePov as "first_person"|"third_person"|"mixed") ?? novel.narrativePov, pacePreference: framing.pacePreference ?? novel.pacePreference, styleTone: framing.styleTone ?? novel.styleTone, emotionIntensity: framing.emotionIntensity ?? novel.emotionIntensity,
      },
    });

    res.json({ data: framing });
  } catch (e) { next(e); }
});

// Generate outline
novelRoutes.post("/:id/outline", async (req, res, next) => {
  try {
    const { outline, validation } = await generateOutline(req.params.id);
    res.json({ data: { outline, validation } });  // M10: consistent {data} wrapper
  } catch (e) {
    console.error("[Outline Error]", e);
    next(e);
  }
});

// Apply outline: sync DraftPlan → Chapter + VolumeChapterPlan (incremental, never deletes drafts)
novelRoutes.post("/:id/outline/apply", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.id;

    // Sync DraftPlans → Chapters (upsert + delete orphans + renumber)
    await syncDraftPlansToWriting(novelId);

    // Sync DraftCharacters → NovelCharacters (upsert + delete orphans)
    const draftChars = await prisma.draftCharacter.findMany({ where: { novelId } });
    const draftCharNames = new Set(draftChars.map(dc => dc.name));
    const draftCharNameMap = new Map(draftChars.map(dc => [dc.name, dc]));

    for (const dc of draftChars) {
      const existing = await prisma.novelCharacter.findFirst({ where: { novelId, name: dc.name } });
      if (existing) {
        await prisma.novelCharacter.update({ where: { id: existing.id }, data: { role: dc.role, personality: dc.personality, background: dc.background, appearance: dc.appearance, quirks: dc.quirks, currentStatus: dc.currentStatus, currentGoal: dc.currentGoal, voiceTexture: dc.voiceTexture, identityLabel: dc.identityLabel, prohibitions: dc.prohibitions } });
      } else {
        await prisma.novelCharacter.create({ data: { novelId, name: dc.name, role: dc.role, personality: dc.personality, background: dc.background, appearance: dc.appearance, quirks: dc.quirks, currentStatus: dc.currentStatus, currentGoal: dc.currentGoal, voiceTexture: dc.voiceTexture, identityLabel: dc.identityLabel, prohibitions: dc.prohibitions } });
      }
      await prisma.draftCharacter.update({ where: { id: dc.id }, data: { synced: true } });
    }

    // Bug 3 fix: delete NovelCharacters that no longer exist in DraftCharacter
    const novelChars = await prisma.novelCharacter.findMany({ where: { novelId } });
    for (const nc of novelChars) {
      if (!draftCharNames.has(nc.name)) {
        await prisma.novelCharacterRelation.deleteMany({ where: { OR: [{ sourceCharacterId: nc.id }, { targetCharacterId: nc.id }] } });
        await prisma.novelCharacter.delete({ where: { id: nc.id } });
      }
    }

    // Bug 2: Sync DraftCharacterRelations → NovelCharacterRelations
    const draftRels = await prisma.draftCharacterRelation.findMany({ where: { novelId } });
    const draftRelKeys = new Set(draftRels.map(r => `${r.sourceCharacterId}:${r.targetCharacterId}`));
    // Map DraftCharacter IDs to NovelCharacter IDs (both reference the same name)
    const dcIdToNcId: Record<string, string> = {};
    for (const dc of draftChars) {
      const nc = await prisma.novelCharacter.findFirst({ where: { novelId, name: dc.name } });
      if (nc) dcIdToNcId[dc.id] = nc.id;
    }

    for (const dr of draftRels) {
      const srcNcId = dcIdToNcId[dr.sourceCharacterId];
      const tgtNcId = dcIdToNcId[dr.targetCharacterId];
      if (!srcNcId || !tgtNcId) continue;
      const existingRel = await prisma.novelCharacterRelation.findFirst({
        where: { novelId, sourceCharacterId: srcNcId, targetCharacterId: tgtNcId },
      });
      if (existingRel) {
        await prisma.novelCharacterRelation.update({ where: { id: existingRel.id }, data: { type: dr.type, summary: dr.summary } });
      } else {
        await prisma.novelCharacterRelation.create({ data: { novelId, sourceCharacterId: srcNcId, targetCharacterId: tgtNcId, type: dr.type, summary: dr.summary } });
      }
      await prisma.draftCharacterRelation.update({ where: { id: dr.id }, data: { synced: true } });
    }

    // Delete NovelCharacterRelations that no longer exist in DraftCharacterRelation
    const novelRels = await prisma.novelCharacterRelation.findMany({ where: { novelId } });
    for (const nr of novelRels) {
      if (!draftRelKeys.has(`${nr.sourceCharacterId}:${nr.targetCharacterId}`)) {
        await prisma.novelCharacterRelation.delete({ where: { id: nr.id } });
      }
    }

    // Sync DraftStorySeed → structuredOutline
    const draftSeed = await prisma.draftStorySeed.findUnique({ where: { novelId } });
    if (draftSeed?.content) {
      const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { structuredOutline: true } });
      let structuredOutline: Record<string, unknown> = {};
      if (novel?.structuredOutline) {
        try { structuredOutline = JSON.parse(novel.structuredOutline); } catch { /* ignore */ }
      }
      try {
        const seedJson = JSON.parse(draftSeed.content);
        structuredOutline.premise = seedJson.premise ?? structuredOutline.premise ?? "";
        structuredOutline.mainArc = seedJson.mainArc ?? structuredOutline.mainArc ?? "";
        structuredOutline.mysteryBox = seedJson.mysteryBox ?? structuredOutline.mysteryBox ?? "";
        structuredOutline.endingDirection = seedJson.endingDirection ?? structuredOutline.endingDirection ?? "";
      } catch { /* ignore */ }
      await prisma.novel.update({ where: { id: novelId }, data: { structuredOutline: JSON.stringify(structuredOutline) } });
    }

    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Generate characters
novelRoutes.post("/:id/characters/generate", async (req, res, next) => {
  try {
    const result = await generateCharacters(req.params.id);
    const prisma = getPrisma();
    const novelId = req.params.id;

    // Bug 1 fix: delete ALL DraftCharacters (not just synced=true) to replace, not append
    await prisma.draftCharacter.deleteMany({ where: { novelId } });

    // Bug 5 fix: include quirks + currentStatus in create
    const charNameToId: Record<string, string> = {};
    for (const c of result.characters) {
      const created = await prisma.draftCharacter.create({
        data: {
          novelId, name: c.name, role: c.role, personality: c.personality, background: c.background,
          appearance: c.appearance ?? null, quirks: c.quirks ?? null,
          currentStatus: c.currentStatus ?? null, currentGoal: c.currentGoal,
          voiceTexture: c.voiceTexture, identityLabel: c.identityLabel, prohibitions: c.prohibitions ?? null,
        },
      });
      charNameToId[c.name] = created.id;
    }

    // Bug 2 fix: write relationships to DraftCharacterRelation
    for (const rel of (result.relationships ?? [])) {
      const sid = charNameToId[rel.source];
      const tid = charNameToId[rel.target];
      if (sid && tid) {
        await prisma.draftCharacterRelation.create({
          data: { novelId, sourceCharacterId: sid, targetCharacterId: tid, type: rel.type, summary: rel.summary },
        });
      }
    }

    res.json({ data: result });
  } catch (e) { console.error("[Character Error]", e); next(e); }
});

// ─── Story Core ──────────────────────────────────────

novelRoutes.post("/:id/story-core", async (req, res, next) => {
  try { res.json({ data: await generateStoryCore(req.params.id) }); } catch (e) { next(e); }
});

// ─── Editorial Info ──────────────────────────────────

novelRoutes.post("/:id/editorial-info", async (req, res, next) => {
  try { res.json({ data: await generateEditorialInfo(req.params.id) }); } catch (e) { next(e); }
});

// ─── Quick Start (batch: story core → characters + blueprint + editorial) ──

novelRoutes.post("/:id/quick-start", async (req, res, next) => {
  try {
    const novelId = req.params.id;
    // Step 1: Generate story core (must succeed first)
    const storyCore = await generateStoryCore(novelId);

    // Step 2: Generate characters, blueprint, editorial info in parallel (each independent)
    const results: Record<string, unknown> = { storyCore };
    const errors: string[] = [];

    const tasks = [
      generateCharacters(novelId).then(async (result) => {
        const prisma = getPrisma();
        // Bug 1 fix: delete ALL DraftCharacters + DraftCharacterRelations
        await prisma.draftCharacterRelation.deleteMany({ where: { novelId } });
        await prisma.draftCharacter.deleteMany({ where: { novelId } });
        const charNameToId: Record<string, string> = {};
        for (const c of result.characters) {
          const created = await prisma.draftCharacter.create({
            data: {
              novelId, name: c.name, role: c.role, personality: c.personality, background: c.background,
              appearance: c.appearance ?? null, quirks: c.quirks ?? null,
              currentStatus: c.currentStatus ?? null, currentGoal: c.currentGoal,
              voiceTexture: c.voiceTexture, identityLabel: c.identityLabel, prohibitions: c.prohibitions ?? null,
            },
          });
          charNameToId[c.name] = created.id;
        }
        // Bug 2 fix: write relationships to DraftCharacterRelation
        for (const rel of (result.relationships ?? [])) {
          const sid = charNameToId[rel.source];
          const tid = charNameToId[rel.target];
          if (sid && tid) {
            await prisma.draftCharacterRelation.create({
              data: { novelId, sourceCharacterId: sid, targetCharacterId: tid, type: rel.type, summary: rel.summary },
            });
          }
        }
        results.characters = result;
      }).catch(e => { errors.push("characters: " + (e instanceof Error ? e.message : String(e))); }),
      generateBlueprint(novelId).then(async (r) => {
          results.blueprint = r;
          // Populate DraftPlans from the generated structuredOutline (same as POST /:id/blueprint)
          const prisma = getPrisma();
          const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { structuredOutline: true } });
          if (novel?.structuredOutline) {
            const outline = JSON.parse(novel.structuredOutline);
            await prisma.draftPlan.deleteMany({ where: { volume: { novelId } } });
            await prisma.volume.deleteMany({ where: { novelId } });
            // Clean orphan Chapters
            const orphanChapters = await prisma.chapter.findMany({
              where: { novelId, volumeChapterPlans: { none: {} } },
              select: { id: true },
            });
            if (orphanChapters.length > 0) {
              await prisma.chapter.deleteMany({ where: { id: { in: orphanChapters.map(c => c.id) } } });
            }
            for (const vol of (outline?.volumes ?? [])) {
              const sortOrder = vol.sortOrder ?? vol.volume ?? 1;
              const volume = await prisma.volume.create({
                data: { novelId, sortOrder, title: vol.title ?? "", summary: vol.summary ?? "" },
              });
              for (const ch of (vol.chapters ?? [])) {
                await prisma.draftPlan.create({
                  data: { volumeId: volume.id, chapterOrder: ch.order ?? ch.chapter, title: ch.title ?? "", summary: ch.coreEvent ?? ch.summary ?? "" },
                });
              }
            }
          }
        }).catch(e => { errors.push("blueprint: " + (e instanceof Error ? e.message : String(e))); }),
      generateEditorialInfo(novelId).then(r => { results.editorialInfo = r; })
        .catch(e => { errors.push("editorialInfo: " + (e instanceof Error ? e.message : String(e))); }),
    ];

    await Promise.allSettled(tasks);

    res.json({ data: { ...results, errors: errors.length > 0 ? errors : undefined } });
  } catch (e) { next(e); }
});

// ─── Draft Story Seed (Phase 17: planning→writing linkage) ─

novelRoutes.put("/:id/draft-story-seed", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.id;
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "content is required" } });
      return;
    }
    const existing = await prisma.draftStorySeed.findUnique({ where: { novelId } });
    const seed = existing
      ? await prisma.draftStorySeed.update({ where: { novelId }, data: { content, synced: false } })
      : await prisma.draftStorySeed.create({ data: { novelId, content } });
    res.json({ data: seed });
  } catch (e) { next(e); }
});

// ─── Confirmation (Phase 17: replaces lock/unlock) ────

novelRoutes.post("/:id/story-seed/confirm", async (req, res, next) => {
  try { await confirmScope(req.params.id, "story_seed"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});
novelRoutes.delete("/:id/story-seed/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.id, "story_seed"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Characters Confirm ──────────────────────────────

novelRoutes.post("/:id/characters/confirm", async (req, res, next) => {
  try { await confirmScope(req.params.id, "characters"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});
novelRoutes.delete("/:id/characters/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.id, "characters"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Blueprint ────────────────────────────────────────

// Undo: restore draft tables from writing tab data
novelRoutes.post("/:novelId/blueprint/restore", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    // Restore DraftPlans from VolumeChapterPlans
    await prisma.draftPlan.deleteMany({ where: { volume: { novelId } } });
    const plans = await prisma.volumeChapterPlan.findMany({ where: { volume: { novelId } }, orderBy: [{ volumeId: "asc" }, { chapterOrder: "asc" }] });
    for (const p of plans) {
      await prisma.draftPlan.create({ data: { volumeId: p.volumeId, chapterOrder: p.chapterOrder, title: p.title, summary: p.summary, synced: true } });
    }
    // Restore DraftCharacters from NovelCharacters
    await prisma.draftCharacter.deleteMany({ where: { novelId } });
    const chars = await prisma.novelCharacter.findMany({ where: { novelId } });
    for (const c of chars) {
      await prisma.draftCharacter.create({ data: { novelId, name: c.name, role: c.role, personality: c.personality, background: c.background, appearance: c.appearance, quirks: c.quirks, currentGoal: c.currentGoal, voiceTexture: c.voiceTexture, identityLabel: c.identityLabel, prohibitions: c.prohibitions, synced: true } });
    }
    // Restore DraftStorySeed from structuredOutline
    const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { structuredOutline: true } });
    if (novel?.structuredOutline) {
      await prisma.draftStorySeed.upsert({
        where: { novelId },
        create: { novelId, content: novel.structuredOutline, synced: true },
        update: { content: novel.structuredOutline, synced: true },
      });
    }
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

novelRoutes.post("/:id/blueprint", async (req, res, next) => {
  try {
    const result = await generateBlueprint(req.params.id, req.body?.volumes);
    // Also populate DraftPlans from the generated structuredOutline
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.id }, select: { structuredOutline: true } });
    if (novel?.structuredOutline) {
      const outline = JSON.parse(novel.structuredOutline);
      // Delete ALL old draft plans + volumes (replace, not append — same as character generation)
      await prisma.draftPlan.deleteMany({ where: { volume: { novelId: req.params.id } } });
      await prisma.volume.deleteMany({ where: { novelId: req.params.id } });
      // Clean orphan Chapters (Volume CASCADE deletes VolumeChapterPlan but Chapter survives via SET NULL)
      const orphanChapters = await prisma.chapter.findMany({
        where: { novelId: req.params.id, volumeChapterPlans: { none: {} } },
        select: { id: true },
      });
      if (orphanChapters.length > 0) {
        await prisma.chapter.deleteMany({ where: { id: { in: orphanChapters.map(c => c.id) } } });
      }
      // Create fresh volumes + draft plans from AI output
      for (const vol of (outline?.volumes ?? [])) {
        const sortOrder = vol.sortOrder ?? vol.volume ?? 1;
        const volume = await prisma.volume.create({
          data: { novelId: req.params.id, sortOrder, title: vol.title ?? "", summary: vol.summary ?? "" },
        });
        for (const ch of (vol.chapters ?? [])) {
          await prisma.draftPlan.create({
            data: { volumeId: volume.id, chapterOrder: ch.order ?? ch.chapter, title: ch.title ?? "", summary: ch.coreEvent ?? ch.summary ?? "" },
          });
        }
      }
    }
    res.json({ data: result });
	  } catch (e) { next(e); }
});
novelRoutes.post("/:id/blueprint/confirm", async (req, res, next) => {
  try {
    const mode = req.body?.mode === "merge" ? "merge" : "replace";
    await confirmScope(req.params.id, "blueprint", { mode });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});
novelRoutes.delete("/:id/blueprint/confirm", async (req, res, next) => {
  try { await unconfirmScope(req.params.id, "blueprint"); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});

// ─── Batch Confirm ────────────────────────────────────

novelRoutes.post("/:id/confirm-all", async (req, res, next) => {
  try {
    const mode = req.body?.mode === "merge" ? "merge" : "replace";
    res.json({ data: { confirmed: await confirmAllScopes(req.params.id, { mode }) } });
  } catch (e) { next(e); }
});
novelRoutes.get("/:id/confirmation-status", async (req, res, next) => {
  try {
    const status = await getConfirmationStatus(req.params.id);
    res.json({ data: status });
  } catch (e) { next(e); }
});

// Generate chapter content (SSE)
novelRoutes.post("/:novelId/chapters/:chapterId/write", async (req, res, next) => {
  try {
    await streamChapter(req.params.novelId, req.params.chapterId, res);
  } catch (e) {
    console.error("[Write Error]", e);
    if (!res.headersSent) next(e);
  }
});

// Quality gate (non-streaming review)
novelRoutes.post("/:novelId/chapters/:chapterId/review", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) {
      res.status(400).json({ error: { code: "NO_CONTENT", message: "章节没有内容" } });
      return;
    }
    const novel = await prisma.novel.findUnique({
      where: { id: req.params.novelId },
      include: { characters: { take: 20 } },
    });
    const characterProhibitions = (novel?.characters ?? [])
      .filter(c => {
        try {
          const p = c.prohibitions ? JSON.parse(c.prohibitions) : [];
          return Array.isArray(p) && p.length > 0;
        } catch { return false; }
      })
      .map(c => ({
        name: c.name,
        prohibitions: JSON.parse(c.prohibitions ?? "[]") as string[],
      }));
    const result = await runQualityGate(chapter.content, {
      genre: novel?.genre,
      characterProhibitions: characterProhibitions.length > 0 ? characterProhibitions : undefined,
      chapterExpectation: chapter.expectation,
    });
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: {
        openingScore: result.openingScore,
        plotScore: result.plotScore,
        characterScore: result.characterScore,
        dialogueScore: result.dialogueScore,
        suspenseScore: result.suspenseScore,
        pacingScore: result.pacingScore,
        languageScore: result.languageScore,
        showNotTellScore: result.showNotTellScore,
        genreScore: result.genreScore,
        qualityScore: (result.openingScore + result.plotScore + result.characterScore + result.dialogueScore + result.suspenseScore + result.pacingScore + result.showNotTellScore + result.languageScore + (result.genreScore ?? 0)),
        repairHistory: JSON.stringify({ overallComment: result.overallComment, issues: result.issues ?? [] }),
      },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// Repair chapter
novelRoutes.post("/:novelId/chapters/:chapterId/repair", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) {
      res.status(400).json({ error: { code: "NO_CONTENT", message: "章节没有内容" } });
      return;
    }
    const issues = req.body.issues ?? "需要改进写作质量，减少AI痕迹，增加展示而非讲述。";
    const repaired = await repairChapter(chapter.content, issues);
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: repaired, chapterStatus: "drafted" },
    });
    res.json({ data: { content: repaired } });
  } catch (e) { next(e); }
});

// Create chapter
novelRoutes.post("/:novelId/chapters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const body = validate(ChapterCreateSchema, req.body);
    const chapter = await prisma.chapter.create({
      data: { ...body, novelId: req.params.novelId },
    });
    res.status(201).json({ data: chapter });
  } catch (e) { next(e); }
});

// ─── Volume CRUD ──────────────────────────────────────

// Blueprint: create volume with DraftPlan
novelRoutes.post("/:novelId/volumes", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const existing = await prisma.volume.findFirst({ where: { novelId }, orderBy: { sortOrder: "desc" } });
    const sortOrder = (existing?.sortOrder ?? 0) + 1;
    const volume = await prisma.volume.create({
      data: {
        novelId, sortOrder,
        title: `第${sortOrder}卷`, summary: "",
        draftPlans: { create: { chapterOrder: 1, title: "第1章", summary: "" } },
      },
      include: { draftPlans: { orderBy: { chapterOrder: "asc" } } },
    });
    res.status(201).json({ data: volume });
  } catch (e) { next(e); }
});

// Writing: create volume with Chapter + VolumeChapterPlan + reverse-sync DraftPlan
novelRoutes.post("/:novelId/volumes/active", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const existing = await prisma.volume.findFirst({ where: { novelId }, orderBy: { sortOrder: "desc" } });
    const sortOrder = (existing?.sortOrder ?? 0) + 1;
    const maxCh = await prisma.chapter.findFirst({ where: { novelId }, orderBy: { order: "desc" } });
    const nextOrder = (maxCh?.order ?? 0) + 1;
    const ch = await prisma.chapter.create({ data: { novelId, order: nextOrder, title: "第1章" } });
    const volume = await prisma.volume.create({
      data: { novelId, sortOrder, title: `第${sortOrder}卷`, summary: "", chapterPlans: { create: { chapterOrder: 1, title: "第1章", summary: "", chapterId: ch.id } } },
      include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } },
    });
    // Reverse-sync: create DraftPlan
    await reverseSyncDraftPlan(volume.id, 1, "第1章", "");
    res.status(201).json({ data: volume });
  } catch (e) { next(e); }
});

// Writing: add chapter to a specific volume (by sortOrder)
novelRoutes.post("/:novelId/volumes/:sortOrder/chapters/writing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const sortOrder = parseInt(req.params.sortOrder);
    const vol = await prisma.volume.findUnique({ where: { novelId_sortOrder: { novelId, sortOrder } } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "卷不存在" } }); return; }
    const maxPlan = await prisma.volumeChapterPlan.findFirst({ where: { volumeId: vol.id }, orderBy: { chapterOrder: "desc" } });
    const localOrder = (maxPlan?.chapterOrder ?? 0) + 1;
    const maxCh = await prisma.chapter.findFirst({ where: { novelId }, orderBy: { order: "desc" } });
    const globalOrder = (maxCh?.order ?? 0) + 1;
    const ch = await prisma.chapter.create({ data: { novelId, order: globalOrder, title: `第${localOrder}章` } });
    const plan = await prisma.volumeChapterPlan.create({
      data: { volumeId: vol.id, chapterOrder: localOrder, title: `第${localOrder}章`, summary: "", chapterId: ch.id },
    });
    // Reverse-sync: create DraftPlan
    await reverseSyncDraftPlan(vol.id, localOrder, `第${localOrder}章`, "");
    res.status(201).json({ data: plan });
  } catch (e) { next(e); }
});

// Blueprint: add DraftPlan chapter to volume
novelRoutes.post("/:novelId/volumes/:sortOrder/chapters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const sortOrder = parseInt(req.params.sortOrder);
    const vol = await prisma.volume.findUnique({ where: { novelId_sortOrder: { novelId, sortOrder } } });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "卷不存在" } }); return; }
    const maxPlan = await prisma.draftPlan.findFirst({ where: { volumeId: vol.id }, orderBy: { chapterOrder: "desc" } });
    const localOrder = (maxPlan?.chapterOrder ?? 0) + 1;
    const plan = await prisma.draftPlan.create({
      data: { volumeId: vol.id, chapterOrder: localOrder, title: `第${localOrder}章`, summary: "" },
    });
    res.status(201).json({ data: plan });
  } catch (e) { next(e); }
});

// Update volume fields
novelRoutes.patch("/:novelId/volumes/:sortOrder", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findUnique({
      where: { novelId_sortOrder: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } },
    });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "卷不存在" } }); return; }
    res.json({ data: await prisma.volume.update({ where: { id: vol.id }, data: req.body }) });
  } catch (e) { next(e); }
});

// Blueprint: update DraftPlan fields — editing draft resets synced
novelRoutes.patch("/:novelId/volumes/:sortOrder/chapters/:planId", async (req, res, next) => {
  try {
    res.json({ data: await getPrisma().draftPlan.update({ where: { id: req.params.planId }, data: { ...req.body, synced: false } }) });
  } catch (e) { next(e); }
});

// Blueprint: delete DraftPlan
novelRoutes.delete("/:novelId/volumes/:sortOrder/chapters/:planId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    await prisma.draftPlan.delete({ where: { id: req.params.planId } });
    // Renumber remaining draft plans
    const vol = await prisma.volume.findUnique({
      where: { novelId_sortOrder: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } },
    });
    if (vol) {
      const remaining = await prisma.draftPlan.findMany({ where: { volumeId: vol.id }, orderBy: { chapterOrder: "asc" } });
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].chapterOrder !== i + 1) {
          await prisma.draftPlan.update({ where: { id: remaining[i].id }, data: { chapterOrder: i + 1 } });
        }
      }
    }
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Writing: delete chapter + VolumeChapterPlan
novelRoutes.delete("/:novelId/volumes/:sortOrder/chapters/writing/:planId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const plan = await prisma.volumeChapterPlan.findUnique({ where: { id: req.params.planId } });
    if (!plan) { res.status(404).json({ error: { code: "NOT_FOUND", message: "章节计划不存在" } }); return; }
    if (plan.chapterId) await prisma.chapter.delete({ where: { id: plan.chapterId } }).catch(() => {});
    await prisma.volumeChapterPlan.delete({ where: { id: plan.id } });
    // Renumber
    const remaining = await prisma.volumeChapterPlan.findMany({ where: { volumeId: plan.volumeId }, orderBy: { chapterOrder: "asc" } });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].chapterOrder !== i + 1) {
        await prisma.volumeChapterPlan.update({ where: { id: remaining[i].id }, data: { chapterOrder: i + 1 } });
      }
    }
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Blueprint: delete volume (only DraftPlans, not Chapters)
novelRoutes.delete("/:novelId/volumes/:sortOrder", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const vol = await prisma.volume.findUnique({
      where: { novelId_sortOrder: { novelId: req.params.novelId, sortOrder: parseInt(req.params.sortOrder) } },
    });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "卷不存在" } }); return; }
    await prisma.draftPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.volume.delete({ where: { id: vol.id } });
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Writing: delete volume (cascade: Chapter + VolumeChapterPlan + DraftPlan + Volume)
novelRoutes.delete("/:novelId/volumes/:sortOrder/writing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const sortOrder = parseInt(req.params.sortOrder);
    const vol = await prisma.volume.findUnique({
      where: { novelId_sortOrder: { novelId, sortOrder } },
      include: { chapterPlans: true },
    });
    if (!vol) { res.status(404).json({ error: { code: "NOT_FOUND", message: "卷不存在" } }); return; }
    // Cascade delete: Chapters → VolumeChapterPlans → DraftPlans → Volume
    for (const plan of vol.chapterPlans) {
      if (plan.chapterId) {
        await prisma.chapter.delete({ where: { id: plan.chapterId } }).catch(() => {});
      }
    }
    await prisma.volumeChapterPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.draftPlan.deleteMany({ where: { volumeId: vol.id } });
    await prisma.volume.delete({ where: { id: vol.id } });
    // Renumber volumes and global chapter orders
    await renumberVolumes(novelId);
    await renumberGlobalChapterOrders(novelId);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// Update character (production — kept for relationship graph etc.)
novelRoutes.patch("/:novelId/characters/:charId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const char = await prisma.novelCharacter.update({ where: { id: req.params.charId }, data: req.body });
    res.json({ data: char });
  } catch (e) { next(e); }
});

// Delete character (production)
novelRoutes.delete("/:novelId/characters/:charId", async (req, res, next) => {
  try { const prisma = getPrisma(); await prisma.novelCharacter.delete({ where: { id: req.params.charId } }); res.status(204).send(); } catch (e) { next(e); }
});

// Create character (production)
novelRoutes.post("/:novelId/characters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const charBody = validate(NovelCharacterCreateSchema, req.body);
    const char = await prisma.novelCharacter.create({ data: { ...charBody, novelId: req.params.novelId } });
    res.status(201).json({ data: char });
  } catch (e) { next(e); }
});

// ─── Draft Character CRUD (planning tab) ─────────────

// Update draft character — editing resets synced so button detects dirty
novelRoutes.patch("/:novelId/draft-characters/:charId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const char = await prisma.draftCharacter.update({ where: { id: req.params.charId }, data: { ...req.body, synced: false } });
    res.json({ data: char });
  } catch (e) { next(e); }
});

// Delete draft character
novelRoutes.delete("/:novelId/draft-characters/:charId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    await prisma.draftCharacter.delete({ where: { id: req.params.charId } });
    res.status(204).send();
  } catch (e) { next(e); }
});

// Create draft character manually
novelRoutes.post("/:novelId/draft-characters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { name, role } = req.body;
    if (!name || !role) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "name and role required" } }); return; }
    const char = await prisma.draftCharacter.create({
      data: { novelId: req.params.novelId, name, role, synced: false },
    });
    res.status(201).json({ data: char });
  } catch (e) { next(e); }
});

// Update chapter
// Update chapter — if title changed, reverse-sync to DraftPlan + VolumeChapterPlan
novelRoutes.patch("/:novelId/chapters/:chapterId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const body = validate(ChapterUpdateSchema, req.body);
    const chapter = await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: body,
    });
    // Reverse-sync title to VolumeChapterPlan and DraftPlan
    if (body.title) {
      const plan = await prisma.volumeChapterPlan.findFirst({ where: { chapterId: chapter.id } });
      if (plan) {
        await prisma.volumeChapterPlan.update({ where: { id: plan.id }, data: { title: body.title } });
        await reverseSyncDraftPlan(plan.volumeId, plan.chapterOrder, body.title, plan.summary);
      }
    }
    res.json({ data: chapter });
  } catch (e) { next(e); }
});

// Delete chapter (writing tab — deletes Chapter + VolumeChapterPlan + DraftPlan, renumbers all)
novelRoutes.delete("/:novelId/chapters/:chapterId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const plan = await prisma.volumeChapterPlan.findFirst({ where: { chapterId: req.params.chapterId } });
    if (plan) {
      // Reverse-sync: delete corresponding DraftPlan
      await deleteDraftPlanForChapter(plan.volumeId, plan.chapterOrder);
      await prisma.volumeChapterPlan.delete({ where: { id: plan.id } });
      await prisma.chapter.delete({ where: { id: req.params.chapterId } });
      // Renumber per-volume chapter orders + global chapter orders
      await renumberWritingChaptersInVolume(plan.volumeId);
      await renumberDraftChaptersInVolume(plan.volumeId);
      await renumberGlobalChapterOrders(req.params.novelId);
    } else {
      await prisma.chapter.delete({ where: { id: req.params.chapterId } });
    }
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── Export ────────────────────────────────────────────

import { exportNovel, exportPreview } from "../export/exportService";

novelRoutes.get("/:novelId/export", async (req, res, next) => {
  try {
    const format = (req.query.format as string) ?? "md";
    if (!["epub", "txt", "md", "json"].includes(format)) {
      res.status(400).json({ error: { code: "INVALID_FORMAT", message: "Format must be epub, txt, md, or json" } });
      return;
    }
    const result = await exportNovel(req.params.novelId, format as "epub" | "txt" | "md" | "json");
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(result.fileName)}"`);
    if (Buffer.isBuffer(result.content)) {
      res.send(result.content);
    } else {
      res.send(Buffer.from(result.content as string, "utf-8"));
    }
  } catch (e) { next(e); }
});

novelRoutes.get("/:novelId/export/preview", async (req, res, next) => {
  try {
    res.json({ data: await exportPreview(req.params.novelId) });
  } catch (e) { next(e); }
});

// ─── Statistics ────────────────────────────────────────

import { getNovelStatistics, getDailyOutput, getQualityTrend, getPayoffStats } from "../export/statisticsService";

novelRoutes.get("/:novelId/statistics", async (req, res, next) => {
  try {
    res.json({ data: await getNovelStatistics(req.params.novelId) });
  } catch (e) { next(e); }
});

novelRoutes.get("/:novelId/statistics/daily", async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    res.json({ data: await getDailyOutput(req.params.novelId, days) });
  } catch (e) { next(e); }
});

novelRoutes.get("/:novelId/statistics/quality", async (req, res, next) => {
  try {
    res.json({ data: await getQualityTrend(req.params.novelId) });
  } catch (e) { next(e); }
});

novelRoutes.get("/:novelId/statistics/payoffs", async (req, res, next) => {
  try {
    res.json({ data: await getPayoffStats(req.params.novelId) });
  } catch (e) { next(e); }
});

// ─── Format Cleanup ────────────────────────────────────

import { detectFormattingIssues, cleanupChapter, cleanupAllChapters } from "../export/formatCleanup";

novelRoutes.get("/:novelId/chapters/:chapterId/format-issues", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const ch = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!ch?.content) {
      res.status(400).json({ error: { code: "NO_CONTENT", message: "章节没有内容" } });
      return;
    }
    res.json({ data: detectFormattingIssues(ch.content) });
  } catch (e) { next(e); }
});

novelRoutes.post("/:novelId/chapters/:chapterId/cleanup", async (req, res, next) => {
  try {
    res.json({ data: await cleanupChapter(req.params.chapterId) });
  } catch (e) { next(e); }
});

novelRoutes.post("/:novelId/cleanup", async (req, res, next) => {
  try {
    res.json({ data: await cleanupAllChapters(req.params.novelId) });
  } catch (e) { next(e); }
});

// ─── 4.1: Undo ──────────────────────────────────────

novelRoutes.post("/:novelId/chapters/:chapterId/undo", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const ch = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!ch?.sceneCards) { res.json({ data: { restored: false, message: "无历史记录" } }); return; }
    let cards: Record<string, unknown> = {};
    try { cards = JSON.parse(ch.sceneCards); } catch { res.json({ data: { restored: false, message: "历史记录损坏" } }); return; }
    const history = (cards.editHistory as Array<{ ts: string; chars: number; content: string }>) ?? [];
    if (history.length === 0) { res.json({ data: { restored: false, message: "无历史记录" } }); return; }
    const last = history.pop()!;
    cards.editHistory = history;
    await prisma.chapter.update({ where: { id: req.params.chapterId }, data: { content: last.content, sceneCards: JSON.stringify(cards) } });
    res.json({ data: { restored: true, ts: last.ts, chars: last.chars } });
  } catch (e) { next(e); }
});

// ─── Phase 14: Storyboard ──────────────────────────────────

import { generateScenePlan, getScenePlan, updateScenePlan, toggleScenePlan } from "../production/scenePlanService";

novelRoutes.get("/:novelId/chapters/:chapterId/scenes", async (req, res, next) => {
  try {
    const plan = await getScenePlan(req.params.novelId, req.params.chapterId);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

novelRoutes.post("/:novelId/chapters/:chapterId/scenes/generate", async (req, res, next) => {
  try {
    const plan = await generateScenePlan(req.params.novelId, req.params.chapterId);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

novelRoutes.put("/:novelId/chapters/:chapterId/scenes", async (req, res, next) => {
  try {
    const { scenes } = req.body;
    if (!scenes || !Array.isArray(scenes)) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "scenes array required" } });
      return;
    }
    const plan = await updateScenePlan(req.params.novelId, req.params.chapterId, scenes);
    res.json({ data: plan });
  } catch (e) { next(e); }
});

novelRoutes.patch("/:novelId/chapters/:chapterId/scenes/toggle", async (req, res, next) => {
  try {
    const { enabled } = req.body;
    res.json({ data: await toggleScenePlan(req.params.novelId, req.params.chapterId, !!enabled) });
  } catch (e) { next(e); }
});

// ─── Phase 10: Revision ────────────────────────────────

import { generateRewriteCandidates, applyRevision, diagnoseWorkspace } from "../production/revisionService";

novelRoutes.post("/:novelId/chapters/:chapterId/revision/candidates", async (req, res, next) => {
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

novelRoutes.post("/:novelId/chapters/:chapterId/revision/apply", async (req, res, next) => {
  try {
    const { selectedParagraphs, replacementText } = req.body;
    if (!selectedParagraphs?.length || !replacementText) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "selectedParagraphs (array) + replacementText required" } });
      return;
    }
    res.json({ data: await applyRevision(req.params.chapterId, selectedParagraphs, replacementText) });
  } catch (e) { next(e); }
});

novelRoutes.post("/:novelId/chapters/:chapterId/diagnose", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const result = await diagnoseWorkspace(req.params.novelId, req.params.chapterId);
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { diagnosis: JSON.stringify(result) },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Phase 12: Character Depth ─────────────────────────

import { listResources, createResource, updateResource, deleteResource, getResourceSummary, checkResourceConsistency } from "../planning/characterPrep/resourceLedgerService";
import { listInfoProfiles, createInfoProfile, updateInfoProfile, deleteInfoProfile, getDramaticIronyReport } from "../planning/characterPrep/infoProfileService";
import { getGraph, upsertRelation, deleteRelation } from "../planning/characterPrep/relationshipGraphService";

novelRoutes.get("/:novelId/resources", async (req, res, next) => {
  try { res.json({ data: await listResources(req.params.novelId, req.query.ownerId as string, req.query.category as string) }); } catch (e) { next(e); }
});
novelRoutes.post("/:novelId/resources", async (req, res, next) => {
  try { res.json({ data: await createResource({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
novelRoutes.patch("/:novelId/resources/:id", async (req, res, next) => {
  try { res.json({ data: await updateResource(req.params.id, req.body) }); } catch (e) { next(e); }
});
novelRoutes.delete("/:novelId/resources/:id", async (req, res, next) => {
  try { await deleteResource(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});
novelRoutes.get("/:novelId/resources/summary", async (req, res, next) => {
  try { res.json({ data: await getResourceSummary(req.params.novelId) }); } catch (e) { next(e); }
});
novelRoutes.get("/:novelId/resources/check", async (req, res, next) => {
  try { res.json({ data: await checkResourceConsistency(req.params.novelId) }); } catch (e) { next(e); }
});

novelRoutes.get("/:novelId/info-profiles", async (req, res, next) => {
  try { res.json({ data: await listInfoProfiles(req.params.novelId, req.query.knowerId as string) }); } catch (e) { next(e); }
});
novelRoutes.post("/:novelId/info-profiles", async (req, res, next) => {
  try { res.json({ data: await createInfoProfile({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
novelRoutes.patch("/:novelId/info-profiles/:id", async (req, res, next) => {
  try { res.json({ data: await updateInfoProfile(req.params.id, req.body) }); } catch (e) { next(e); }
});
novelRoutes.delete("/:novelId/info-profiles/:id", async (req, res, next) => {
  try { await deleteInfoProfile(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});
novelRoutes.get("/:novelId/irony-report", async (req, res, next) => {
  try { res.json({ data: await getDramaticIronyReport(req.params.novelId) }); } catch (e) { next(e); }
});

// ─── Draft Character Relations (planning tab) ─────────

// Get draft relation graph for display in planning tab
novelRoutes.get("/:novelId/draft-relations/graph", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const draftChars = await prisma.draftCharacter.findMany({ where: { novelId }, select: { id: true, name: true, role: true } });
    const draftRels = await prisma.draftCharacterRelation.findMany({ where: { novelId } });
    const nodes = draftChars.map(c => ({ id: c.id, name: c.name, role: c.role }));
    const edges = draftRels
      .map(r => {
        const srcName = draftChars.find(c => c.id === r.sourceCharacterId)?.name ?? "";
        const tgtName = draftChars.find(c => c.id === r.targetCharacterId)?.name ?? "";
        return {
          id: r.id, sourceId: r.sourceCharacterId, targetId: r.targetCharacterId, type: r.type,
          sourceName: srcName, targetName: tgtName, summary: r.summary,
          attitudeSource: null, attitudeTarget: null, stage: null,
        };
      })
      .filter(e => e.sourceName && e.targetName); // drop orphaned relations
    // Clean up orphaned relations (broken character refs)
    const orphanIds = draftRels
      .filter(r => !draftChars.find(c => c.id === r.sourceCharacterId)?.name || !draftChars.find(c => c.id === r.targetCharacterId)?.name)
      .map(r => r.id);
    if (orphanIds.length > 0) {
      await prisma.draftCharacterRelation.deleteMany({ where: { id: { in: orphanIds } } });
    }
    res.json({ data: { nodes, edges } });
  } catch (e) { next(e); }
});

novelRoutes.post("/:novelId/draft-relations", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { sourceCharacterId, targetCharacterId, type } = req.body;
    if (!sourceCharacterId || !targetCharacterId || !type) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "sourceCharacterId, targetCharacterId, type required" } });
      return;
    }
    const rel = await prisma.draftCharacterRelation.create({
      data: { novelId: req.params.novelId, sourceCharacterId, targetCharacterId, type, summary: "" },
    });
    res.status(201).json({ data: rel });
  } catch (e) { next(e); }
});

novelRoutes.delete("/:novelId/draft-relations/:id", async (req, res, next) => {
  try {
    await getPrisma().draftCharacterRelation.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) { next(e); }
});

// ─── Production Relations (writing tab) ───────────────

novelRoutes.get("/:novelId/relations/graph", async (req, res, next) => {
  try { res.json({ data: await getGraph(req.params.novelId) }); } catch (e) { next(e); }
});
novelRoutes.post("/:novelId/relations", async (req, res, next) => {
  try { res.json({ data: await upsertRelation({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
novelRoutes.delete("/:novelId/relations/:id", async (req, res, next) => {
  try { await deleteRelation(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});
