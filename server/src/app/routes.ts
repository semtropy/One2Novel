import { type Express, Router } from "express";
import { novelRoutes } from "../modules/novel/setup/http";
import { styleRoutes } from "../modules/style/http";
import { probeLLM } from "../platform/llm/connectivity";
import { getPrisma } from "../platform/db/client";
import { getStateSnapshots } from "../modules/novel/production/stateSnapshot";
import { detectTimelineConflicts, getPreChapterReminders, reExtractChapterTimeline } from "../modules/timeline/timelineService";

// Sub-routers (one per functional domain)
import directorRoutes from "./routes/director.routes";
import settingsRoutes from "./routes/settings.routes";
import worldRoutes from "./routes/world.routes";
import payoffRoutes from "./routes/payoff.routes";
import referenceProfileRoutes from "../modules/novel/setup/routes/planning/reference-profile.routes";

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
  api.use("/", payoffRoutes);
  api.use("/", referenceProfileRoutes);
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

  // ── State Snapshots ──
  api.get("/novels/:id/snapshots", async (req, res, next) => {
    try { res.json({ data: await getStateSnapshots(req.params.id) }); } catch (e) { next(e); }
  });

  app.use("/api", api);
}
