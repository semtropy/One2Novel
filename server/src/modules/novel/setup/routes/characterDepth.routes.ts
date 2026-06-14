import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { NovelCharacterCreateSchema } from "@one2novel/shared/types/novel";
import { validate } from "../validate";
import { listResources, createResource, updateResource, deleteResource, getResourceSummary, checkResourceConsistency } from "../../planning/characterPrep/resourceLedgerService";
import { listInfoProfiles, createInfoProfile, updateInfoProfile, deleteInfoProfile, getDramaticIronyReport } from "../../planning/characterPrep/infoProfileService";
import { getGraph, upsertRelation, deleteRelation } from "../../planning/characterPrep/relationshipGraphService";

const router = Router();

// ─── Character CRUD (production) ─────────────────────

router.patch("/:novelId/characters/:charId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    res.json({ data: await prisma.novelCharacter.update({ where: { id: req.params.charId }, data: req.body }) });
  } catch (e) { next(e); }
});

router.delete("/:novelId/characters/:charId", async (req, res, next) => {
  try { const prisma = getPrisma(); await prisma.novelCharacter.delete({ where: { id: req.params.charId } }); res.status(204).send(); } catch (e) { next(e); }
});

router.post("/:novelId/characters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const input = validate(NovelCharacterCreateSchema, req.body);
    res.status(201).json({ data: await prisma.novelCharacter.create({ data: { ...input, novelId: req.params.novelId } }) });
  } catch (e) { next(e); }
});

// ─── Draft Character CRUD ────────────────────────────

router.patch("/:novelId/draft-characters/:charId", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    res.json({ data: await prisma.draftCharacter.update({ where: { id: req.params.charId }, data: { ...req.body, synced: false } }) });
  } catch (e) { next(e); }
});

router.delete("/:novelId/draft-characters/:charId", async (req, res, next) => {
  try { const prisma = getPrisma(); await prisma.draftCharacter.delete({ where: { id: req.params.charId } }); res.status(204).send(); } catch (e) { next(e); }
});

router.post("/:novelId/draft-characters", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { name, role } = req.body;
    if (!name || !role) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "name and role required" } }); return; }
    const char = await prisma.draftCharacter.create({ data: { novelId: req.params.novelId, name, role, synced: false } });
    res.status(201).json({ data: char });
  } catch (e) { next(e); }
});

// ─── Character Depth (Phase 12) ──────────────────────

router.get("/:novelId/resources", async (req, res, next) => {
  try { res.json({ data: await listResources(req.params.novelId, req.query.ownerId as string, req.query.category as string) }); } catch (e) { next(e); }
});
router.post("/:novelId/resources", async (req, res, next) => {
  try { res.json({ data: await createResource({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
router.patch("/:novelId/resources/:id", async (req, res, next) => {
  try { res.json({ data: await updateResource(req.params.id, req.body) }); } catch (e) { next(e); }
});
router.delete("/:novelId/resources/:id", async (req, res, next) => {
  try { await deleteResource(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});
router.get("/:novelId/resources/summary", async (req, res, next) => {
  try { res.json({ data: await getResourceSummary(req.params.novelId) }); } catch (e) { next(e); }
});
router.get("/:novelId/resources/check", async (req, res, next) => {
  try { res.json({ data: await checkResourceConsistency(req.params.novelId) }); } catch (e) { next(e); }
});

router.get("/:novelId/info-profiles", async (req, res, next) => {
  try { res.json({ data: await listInfoProfiles(req.params.novelId, req.query.knowerId as string) }); } catch (e) { next(e); }
});
router.post("/:novelId/info-profiles", async (req, res, next) => {
  try { res.json({ data: await createInfoProfile({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
router.patch("/:novelId/info-profiles/:id", async (req, res, next) => {
  try { res.json({ data: await updateInfoProfile(req.params.id, req.body) }); } catch (e) { next(e); }
});
router.delete("/:novelId/info-profiles/:id", async (req, res, next) => {
  try { await deleteInfoProfile(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});
router.get("/:novelId/irony-report", async (req, res, next) => {
  try { res.json({ data: await getDramaticIronyReport(req.params.novelId) }); } catch (e) { next(e); }
});

// ─── Draft Character Relations (planning tab) ────────

router.get("/:novelId/draft-relations/graph", async (req, res, next) => {
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
        return { id: r.id, sourceId: r.sourceCharacterId, targetId: r.targetCharacterId, type: r.type, sourceName: srcName, targetName: tgtName, summary: r.summary, attitudeSource: null, attitudeTarget: null, stage: null };
      })
      .filter(e => e.sourceName && e.targetName);
    const orphanIds = draftRels.filter(r => !draftChars.find(c => c.id === r.sourceCharacterId)?.name || !draftChars.find(c => c.id === r.targetCharacterId)?.name).map(r => r.id);
    if (orphanIds.length > 0) { await prisma.draftCharacterRelation.deleteMany({ where: { id: { in: orphanIds } } }); }
    res.json({ data: { nodes, edges } });
  } catch (e) { next(e); }
});

router.post("/:novelId/draft-relations", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const { sourceCharacterId, targetCharacterId, type } = req.body;
    if (!sourceCharacterId || !targetCharacterId || !type) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "sourceCharacterId, targetCharacterId, type required" } }); return;
    }
    const rel = await prisma.draftCharacterRelation.create({ data: { novelId: req.params.novelId, sourceCharacterId, targetCharacterId, type, summary: "" } });
    res.status(201).json({ data: rel });
  } catch (e) { next(e); }
});

router.delete("/:novelId/draft-relations/:id", async (req, res, next) => {
  try { await getPrisma().draftCharacterRelation.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (e) { next(e); }
});

// ─── Production Relations (writing tab) ─────────────

router.get("/:novelId/relations/graph", async (req, res, next) => {
  try { res.json({ data: await getGraph(req.params.novelId) }); } catch (e) { next(e); }
});
router.post("/:novelId/relations", async (req, res, next) => {
  try { res.json({ data: await upsertRelation({ novelId: req.params.novelId, ...req.body }) }); } catch (e) { next(e); }
});
router.delete("/:novelId/relations/:id", async (req, res, next) => {
  try { await deleteRelation(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});

export default router;
