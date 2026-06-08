import { Router } from "express";
import {
  listStyleProfiles, getStyleProfile, createStyleProfile, deleteStyleProfile,
  extractStyle, bindStyle, unbindStyle, getStyleBindings,
} from "./styleService";
import { resolveStyleContext } from "./styleRuntimeResolver";

export const styleRoutes = Router();

// List all
styleRoutes.get("/", async (_req, res, next) => {
  try { res.json({ data: await listStyleProfiles() }); } catch (e) { next(e); }
});

// Get one
styleRoutes.get("/:id", async (req, res, next) => {
  try { res.json({ data: await getStyleProfile(req.params.id) }); } catch (e) { next(e); }
});

// Create
styleRoutes.post("/", async (req, res, next) => {
  try {
    const profile = await createStyleProfile(req.body);
    res.status(201).json({ data: profile });
  } catch (e) { next(e); }
});

// Delete
styleRoutes.delete("/:id", async (req, res, next) => {
  try { await deleteStyleProfile(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});

// Extract style from source text
styleRoutes.post("/:id/extract", async (req, res, next) => {
  try { res.json({ data: await extractStyle(req.params.id) }); } catch (e) { next(e); }
});

// Bind to target
styleRoutes.post("/:id/bind", async (req, res, next) => {
  try {
    const { targetType, targetId } = req.body;
    res.json({ data: await bindStyle(req.params.id, targetType, targetId) });
  } catch (e) { next(e); }
});

// Unbind
styleRoutes.delete("/:id/bind/:bindingId", async (req, res, next) => {
  try { await unbindStyle(req.params.bindingId); res.status(204).send(); } catch (e) { next(e); }
});

// Get bindings
styleRoutes.get("/bindings/:targetType/:targetId", async (req, res, next) => {
  try { res.json({ data: await getStyleBindings(req.params.targetType, req.params.targetId) }); } catch (e) { next(e); }
});

// Get resolved style context for a novel + optional chapter
styleRoutes.get("/resolved/:novelId", async (req, res, next) => {
  try {
    const chapterId = req.query.chapterId as string | undefined;
    res.json({ data: await resolveStyleContext(req.params.novelId, chapterId) });
  } catch (e) { next(e); }
});
