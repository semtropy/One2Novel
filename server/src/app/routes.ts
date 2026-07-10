import { type Express, Router } from "express";
import { novelRoutes } from "../modules/novel/setup/http";
import { styleRoutes } from "../modules/style/http";
import { probeLLM } from "../platform/llm/connectivity";
import { getPrisma } from "../platform/db/client";
import { checkDbHealth } from "../platform/db/client";
import { getStateSnapshots } from "../modules/novel/production/stateSnapshot";
import { detectTimelineConflicts, getPreChapterReminders, reExtractChapterTimeline } from "../modules/timeline/timelineService";
import { errorHandlerWrap } from "../platform/errors/requestErrorHandler";

// Sub-routers (one per functional domain)
import directorRoutes from "./routes/director.routes";
import settingsRoutes from "./routes/settings.routes";
import worldRoutes from "./routes/world.routes";
import payoffRoutes from "./routes/payoff.routes";
import referenceProfileRoutes from "../modules/novel/setup/routes/planning/reference-profile.routes";
import commitRoutes from "../modules/novel/setup/routes/commit.routes";

export function registerRoutes(app: Express) {
  const api = Router();

  // Health
  api.get("/health", errorHandlerWrap(async (_req, res) => {
    const dbHealth = await checkDbHealth();
    res.json({ data: { status: dbHealth.status === "healthy" ? "ok" : "degraded", timestamp: new Date().toISOString(), db: dbHealth } });
  }));

  // LLM probe
  api.get("/llm/probe", errorHandlerWrap(async (_req, res) => {
    res.json({ data: await probeLLM() });
  }));

  // ── Sub-routers ──
  api.use("/", directorRoutes);
  api.use("/", settingsRoutes);
  api.use("/", worldRoutes);
  api.use("/", payoffRoutes);
  api.use("/", referenceProfileRoutes);
  api.use("/novels", commitRoutes);
  api.use("/novels", novelRoutes);
  api.use("/styles", styleRoutes);

  // ── Timeline ──
  api.get("/novels/:novelId/timeline/conflicts", errorHandlerWrap(async (req, res) => {
    res.json({ data: await detectTimelineConflicts(String(req.params.novelId)) });
  }));
  api.get("/novels/:novelId/timeline/reminders/:chapterOrder", errorHandlerWrap(async (req, res) => {
    const result = await getPreChapterReminders(String(req.params.novelId), parseInt(String(req.params.chapterOrder)));
    res.json({ data: result });
  }));
  api.post("/novels/:novelId/chapters/:chapterId/timeline/re-extract", errorHandlerWrap(async (req, res) => {
    const result = await reExtractChapterTimeline(String(req.params.novelId), String(req.params.chapterId));
    res.json({ data: result });
  }));

  // ── State Snapshots ──
  api.get("/novels/:id/snapshots", errorHandlerWrap(async (req, res) => {
    res.json({ data: await getStateSnapshots(String(req.params.id)) });
  }));

  // ── RAG Stats ──
  api.get("/rag/stats", errorHandlerWrap(async (_req, res) => {
    const { getRAGService } = await import("../platform/rag/ragService");
    const rag = getRAGService();
    const stats = rag.getStats();
    res.json({ data: {
      ...stats,
      degradedSince: rag.getDegradedSince(),
      lastError: rag.getLastError(),
      hasEverDegraded: rag.hasEverDegraded(),
    }});
  }));

  app.use("/api", api);
}
