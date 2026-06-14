import { type Express, Router } from "express";
import { novelRoutes } from "../modules/novel/setup/http";
import { styleRoutes } from "../modules/style/http";
import { probeLLM } from "../platform/llm/connectivity";
import { getPrisma } from "../platform/db/client";
import { generateBeatSheet } from "../modules/novel/planning/storyMacro/beatSheetService";
import { refineChapterDetails } from "../modules/novel/planning/chapterDetail";
import { getStateSnapshots } from "../modules/novel/production/stateSnapshot";
import { detectTimelineConflicts, getPreChapterReminders, reExtractChapterTimeline } from "../modules/timeline/timelineService";

// Sub-routers (one per functional domain)
import directorRoutes from "./routes/director.routes";
import settingsRoutes from "./routes/settings.routes";
import worldRoutes from "./routes/world.routes";
import chatRoutes from "./routes/chat.routes";
import payoffRoutes from "./routes/payoff.routes";

export function registerRoutes(app: Express) {
  const api = Router();

  // Health
  api.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });
  });

  // LLM probe
  api.get("/llm/probe", async (_req, res) => {
    res.json({ data: await probeLLM() });
  });

  // ── Sub-routers ──
  api.use("/", directorRoutes);
  api.use("/", settingsRoutes);
  api.use("/", worldRoutes);
  api.use("/", chatRoutes);
  api.use("/", payoffRoutes);
  api.use("/novels", novelRoutes);
  api.use("/styles", styleRoutes);

  // ── Timeline ──
  api.get("/novels/:novelId/timeline/conflicts", async (req, res, next) => {
    try { res.json({ data: await detectTimelineConflicts(req.params.novelId) }); } catch (e) { next(e); }
  });
  api.get("/novels/:novelId/timeline/reminders/:chapterOrder", async (req, res, next) => {
    try {
      const result = await getPreChapterReminders(req.params.novelId, parseInt(req.params.chapterOrder));
      res.json({ data: result });
    } catch (e) { next(e); }
  });
  api.post("/novels/:novelId/chapters/:chapterId/timeline/re-extract", async (req, res, next) => {
    try {
      const result = await reExtractChapterTimeline(req.params.novelId, req.params.chapterId);
      res.json({ data: result });
    } catch (e) { next(e); }
  });

  // ── Beat Sheet ──
  api.get("/novels/:id/volumes/:sortOrder/beats", async (req, res, next) => {
    try {
      const novelId = req.params.id;
      const sortOrder = parseInt(req.params.sortOrder);
      const beats = await getPrisma().volumeChapterPlan.findMany({
        where: { volume: { novelId, sortOrder } },
        orderBy: { chapterOrder: "asc" },
        select: { chapterOrder: true, purpose: true, conflictLevel: true, revealLevel: true, exclusiveEvent: true, endingState: true, taskSheet: true, mustAvoid: true, targetWordCount: true },
      });
      if (beats.length > 0 && beats.some(b => b.purpose || b.taskSheet)) {
        res.json({ data: beats });
        return;
      }
      const novel = await getPrisma().novel.findUnique({ where: { id: novelId } });
      if (novel?.structuredOutline) {
        try {
          const outline = JSON.parse(novel.structuredOutline);
          const vol = (outline.volumes as Array<{ sortOrder: number; chapters: Array<{ order: number; coreEvent?: string; summary?: string; conflictLevel?: number; revealLevel?: number }> }>)
            ?.find(v => v.sortOrder === sortOrder);
          if (vol?.chapters) {
            const outlineBeats = vol.chapters.map(ch => ({
              chapterOrder: ch.order,
              purpose: ch.coreEvent || ch.summary || "",
              conflictLevel: ch.conflictLevel ?? 5,
              revealLevel: ch.revealLevel ?? 5,
              taskSheet: null,
              exclusiveEvent: null,
              endingState: null,
              mustAvoid: null,
              targetWordCount: null,
            }));
            res.json({ data: outlineBeats });
            return;
          }
        } catch {}
      }
      res.json({ data: beats });
    } catch (e) { next(e); }
  });
  api.post("/novels/:id/volumes/:sortOrder/beats", async (req, res, next) => {
    try {
      const novelId = req.params.id;
      const sortOrder = parseInt(req.params.sortOrder);
      const novel = await getPrisma().novel.findUnique({ where: { id: novelId } });
      let outlineChapters: Array<{ order: number; title: string; summary: string }> | undefined;
      if (novel?.structuredOutline) {
        try {
          const outline = JSON.parse(novel.structuredOutline);
          const vol = (outline.volumes as Array<{ sortOrder: number; chapters: Array<{ order: number; title: string; summary: string }> }>)
            ?.find(v => v.sortOrder === sortOrder);
          if (vol?.chapters) {
            outlineChapters = vol.chapters.map(c => ({ order: c.order, title: c.title, summary: c.summary ?? "" }));
          }
        } catch {}
      }
      res.json({ data: await generateBeatSheet(novelId, sortOrder, { outlineChapters }) });
    } catch (e) { next(e); }
  });

  // ── Chapter Detail Refinement ──
  api.post("/novels/:id/volumes/:sortOrder/refine", async (req, res, next) => {
    try { res.json({ data: await refineChapterDetails(req.params.id, parseInt(req.params.sortOrder)) }); } catch (e) { next(e); }
  });

  // ── State Snapshots ──
  api.get("/novels/:id/snapshots", async (req, res, next) => {
    try { res.json({ data: await getStateSnapshots(req.params.id) }); } catch (e) { next(e); }
  });

  app.use("/api", api);
}
