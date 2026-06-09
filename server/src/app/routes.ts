import { type Express, Router } from "express";
import { novelRoutes } from "../modules/novel/setup/http";
import { styleRoutes } from "../modules/style/http";
import { probeLLM } from "../platform/llm/connectivity";
import { runDirector, getDirectorProgress, stopDirector, directorEmitter } from "../modules/novel/director/directorService";
import { loadCheckpoint } from "../modules/novel/director/checkpointService";
import { scanChapterForPayoffs, getPayoffs, createPayoff, updatePayoff, deletePayoff } from "../modules/payoff/payoffService";
import { detectTimelineConflicts, getPreChapterReminders, reExtractChapterTimeline } from "../modules/timeline/timelineService";
import { listRules, createRule, updateRule, deleteRule, batchGenerateRules, checkConflict, checkAllConflicts, resolveConflict } from "../modules/novel/world/worldRuleService";
import { getActiveRulesContext } from "../modules/novel/world/ruleActivationService";
import { generateBeatSheet } from "../modules/novel/planning/volumeStrategy";
import { getStateSnapshots } from "../modules/novel/production/stateSnapshot";
import { getPrisma } from "../platform/db/client";
import { getPreferences, savePreferences, saveApiKey } from "../modules/settings/preferences";
import { getEnv, reloadEnv } from "../platform/config/env";
import { createLLM } from "../platform/llm/provider";
import { HumanMessage } from "@langchain/core/messages";
import { processChatMessage, executeAction } from "../modules/creativeHub/chatService";
import { refineChapterDetails } from "../modules/novel/planning/chapterDetail";

export function registerRoutes(app: Express) {
  const api = Router();

  api.get("/health", (_req, res) => {
    res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });  // M9: consistent {data} wrapper
  });

  api.get("/llm/probe", async (_req, res) => {
    res.json({ data: await probeLLM() });
  });

  // Auto-Director
  api.post("/novels/:id/director/run", async (req, res, next) => {
    try {
      // M2: validate novel exists before returning started=true
      const novel = await getPrisma().novel.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
      runDirector(req.params.id, req.body.maxChapters).catch(console.error);
      res.json({ data: { started: true } });
    } catch (e) { next(e); }
  });
  api.post("/novels/:id/director/stop", (req, res) => {
    const stopped = stopDirector(req.params.id);
    res.json({ data: { stopped } });
  });
  api.get("/novels/:id/director/progress", (req, res) => {
    res.json({ data: getDirectorProgress(req.params.id) });
  });

  // SSE stream for director progress (event-driven, no polling)
  api.get("/novels/:id/director/stream", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (evt: string, data: unknown) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
    const novelId = req.params.id;
    const onChapter = (data: { novelId: string; order: number; total: number }) => { if (data.novelId === novelId) send("chapter", data); };
    const onDone = (data: { novelId: string; total: number }) => { if (data.novelId === novelId) { send("done", data); cleanup(); } };
    const onError = (data: { novelId: string; message: string }) => { if (data.novelId === novelId) { send("error", data); cleanup(); } };
    const onToken = (data: { novelId: string; text: string }) => { if (data.novelId === novelId) send("token", data); };
    const cleanup = () => { directorEmitter.off("chapter", onChapter); directorEmitter.off("done", onDone); directorEmitter.off("error", onError); directorEmitter.off("token", onToken); res.end(); };
    directorEmitter.on("chapter", onChapter);
    directorEmitter.on("done", onDone);
    directorEmitter.on("error", onError);
    directorEmitter.on("token", onToken);
    req.on("close", cleanup);
  });

  // F1: Resume interrupted director run
  api.post("/novels/:id/director/resume", async (req, res, next) => {
    try {
      const novel = await getPrisma().novel.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
      const checkpoint = await loadCheckpoint(req.params.id);
      if (!checkpoint) {
        res.status(400).json({ error: { code: "NO_CHECKPOINT", message: "没有可恢复的进度" } });
        return;
      }
      const remaining = checkpoint.totalChaptersToWrite - checkpoint.completedChapterIds.length;
      runDirector(req.params.id, remaining).catch(console.error);
      res.json({ data: { resumed: true, fromChapter: checkpoint.currentChapterOrder, remaining } });
    } catch (e) { next(e); }
  });

  // Payoff scanning (triggered after chapter write)
  api.post("/novels/:novelId/chapters/:chapterId/payoffs/scan", async (req, res, next) => {
    try {
      await scanChapterForPayoffs(req.params.novelId, req.params.chapterId);
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });
  api.get("/novels/:novelId/payoffs", async (req, res, next) => {
    try { res.json({ data: await getPayoffs(req.params.novelId) }); } catch (e) { next(e); }
  });
  api.post("/novels/:novelId/payoffs", async (req, res, next) => {
    try {
      const { title, summary, scopeType, targetStartOrder, targetEndOrder } = req.body;
      if (!title) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "title required" } }); return; }
      res.json({ data: await createPayoff(req.params.novelId, { title, summary, scopeType, targetStartOrder, targetEndOrder }) });
    } catch (e) { next(e); }
  });

  api.patch("/novels/:novelId/payoffs/:id", async (req, res, next) => {
    try { res.json({ data: await updatePayoff(req.params.id, req.body) }); } catch (e) { next(e); }
  });

  api.delete("/novels/:novelId/payoffs/:id", async (req, res, next) => {
    try { await deletePayoff(req.params.id); res.status(204).send(); } catch (e) { next(e); }
  });

  // Timeline conflict detection (Phase 16)
  api.get("/novels/:novelId/timeline/conflicts", async (req, res, next) => {
    try { res.json({ data: await detectTimelineConflicts(req.params.novelId) }); } catch (e) { next(e); }
  });
  api.get("/novels/:novelId/timeline/reminders/:chapterOrder", async (req, res, next) => {
    try {
      const result = await getPreChapterReminders(req.params.novelId, parseInt(req.params.chapterOrder));
      res.json({ data: result });
    } catch (e) { next(e); }
  });

  // Manual re-extraction after author edits chapter content
  api.post("/novels/:novelId/chapters/:chapterId/timeline/re-extract", async (req, res, next) => {
    try {
      const result = await reExtractChapterTimeline(req.params.novelId, req.params.chapterId);
      res.json({ data: result });
    } catch (e) { next(e); }
  });

  // Settings
  api.get("/settings", (_req, res) => {
    res.json({
      data: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? "***" + process.env.DEEPSEEK_API_KEY.slice(-4) : "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "***" + process.env.OPENAI_API_KEY.slice(-4) : "",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***" + process.env.ANTHROPIC_API_KEY.slice(-4) : "",
      },
    });
  });
  api.post("/settings", (req, res) => {
    const { key, provider } = req.body;
    if (key && provider) {
      process.env[`${provider.toUpperCase()}_API_KEY`] = key;
      saveApiKey(provider, key);
    }
    reloadEnv();
    res.json({ data: { ok: true } });
  });

  // Provider list
  api.get("/settings/providers", (_req, res) => {
    const prefs = getPreferences().preferences;
    const models = prefs.providerModels ?? {};
    const envMap: Record<string, string> = {
      deepseek: getEnv().DEEPSEEK_MODEL,
      openai: getEnv().OPENAI_MODEL,
      anthropic: getEnv().ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    };
    const mask = (p: string) => {
      const k = process.env[p + "_API_KEY"];
      return k ? "***" + k.slice(-4) : "";
    };
    const providers = [
      { provider: "deepseek", name: "DeepSeek", defaultModel: envMap.deepseek, currentModel: models.deepseek || "", maskedKey: mask("DEEPSEEK"), isConfigured: !!process.env.DEEPSEEK_API_KEY },
      { provider: "openai", name: "OpenAI", defaultModel: envMap.openai, currentModel: models.openai || "", maskedKey: mask("OPENAI"), isConfigured: !!process.env.OPENAI_API_KEY },
      { provider: "anthropic", name: "Anthropic Claude", defaultModel: envMap.anthropic, currentModel: models.anthropic || "", maskedKey: mask("ANTHROPIC"), isConfigured: !!process.env.ANTHROPIC_API_KEY },
    ];
    res.json({ data: providers });
  });

  // Save provider config
  api.post("/settings/providers/:provider", (req, res) => {
    const { key, model } = req.body;
    if (key) {
      process.env[`${req.params.provider.toUpperCase()}_API_KEY`] = key;
      saveApiKey(req.params.provider, key);
      reloadEnv();
    }
    if (model !== undefined) {
      const prefs = getPreferences();
      const providerModels = { ...(prefs.preferences.providerModels ?? {}), [req.params.provider]: model };
      savePreferences({ providerModels });
    }
    res.json({ data: { ok: true } });
  });

  // Test single provider
  api.post("/settings/providers/:provider/test", async (req, res) => {
    try {
      const provider = req.params.provider as "deepseek" | "openai" | "anthropic";
      const env = getEnv();
      const prefs = getPreferences().preferences;
      const models = prefs.providerModels ?? {};
      const model = models[provider] || (provider === "deepseek" ? env.DEEPSEEK_MODEL : provider === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL);
      const start = Date.now();
      const llm = createLLM(provider, { model, temperature: 0, maxTokens: 10 });
      await llm.invoke([new (await import("@langchain/core/messages")).HumanMessage("Hi")]);
      res.json({ data: { ok: true, model, provider, latencyMs: Date.now() - start } });
    } catch (e) {
      res.json({ data: { ok: false, error: e instanceof Error ? e.message : "Connection failed" } });
    }
  });

  // Creative Hub Chat
  api.post("/chat", async (req, res, next) => {
    try {
      const { message, novelId } = req.body;
      const result = await processChatMessage(message, novelId);
      res.json({ data: result });
    } catch (e) { next(e); }
  });
  api.post("/chat/action", async (req, res, next) => {
    try {
      const { action, novelId } = req.body;
      const result = await executeAction(action, novelId);
      res.json({ data: result });
    } catch (e) { next(e); }
  });

  // Preferences
  api.get("/preferences", (_req, res) => {
    res.json({ data: getPreferences() });
  });
  api.post("/preferences", (req, res) => {
    res.json({ data: savePreferences(req.body) });
  });

  // Structured World Rules
  api.get("/novels/:id/world/rules", async (req, res, next) => {
    try {
      const category = req.query.category as string | undefined;
      res.json({ data: await listRules(req.params.id, category) });
    } catch (e) { next(e); }
  });
  api.post("/novels/:id/world/rules", async (req, res, next) => {
    try { res.json({ data: await createRule(req.params.id, req.body) }); } catch (e) { next(e); }
  });
  api.patch("/novels/:id/world/rules/:ruleId", async (req, res, next) => {
    try { res.json({ data: await updateRule(req.params.ruleId, req.body) }); } catch (e) { next(e); }
  });
  api.delete("/novels/:id/world/rules/:ruleId", async (req, res, next) => {
    try { await deleteRule(req.params.ruleId); res.status(204).send(); } catch (e) { next(e); }
  });
  api.post("/novels/:id/world/rules/generate", async (req, res, next) => {
    try { res.json({ data: await batchGenerateRules(req.params.id) }); } catch (e) { next(e); }
  });
  api.post("/novels/:id/world/rules/check-conflicts", async (req, res, next) => {
    try { res.json({ data: await checkAllConflicts(req.params.id) }); } catch (e) { next(e); }
  });
  api.post("/novels/:id/world/rules/:ruleId/resolve-conflict", async (req, res, next) => {
    try { res.json({ data: await resolveConflict(req.params.ruleId, req.body.resolution) }); } catch (e) { next(e); }
  });

  // Beat sheet
  api.get("/novels/:id/volumes/:sortOrder/beats", async (req, res, next) => {
    try {
      const novelId = req.params.id;
      const sortOrder = parseInt(req.params.sortOrder);
      const beats = await getPrisma().volumeChapterPlan.findMany({
        where: { volume: { novelId, sortOrder } },
        orderBy: { chapterOrder: "asc" },
        select: { chapterOrder: true, purpose: true, conflictLevel: true, revealLevel: true, exclusiveEvent: true, endingState: true, taskSheet: true, mustAvoid: true, targetWordCount: true },
      });
      // If DB has record with actual beat data, return it
      if (beats.length > 0 && beats.some(b => b.purpose || b.taskSheet)) {
        res.json({ data: beats });
        return;
      }
      // Fallback: extract chapter-level info from structuredOutline for preview display
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
      // Try DB first; if no volume records exist, extract chapters from structuredOutline as fallback
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

  // Chapter detail refinement
  api.post("/novels/:id/volumes/:sortOrder/refine", async (req, res, next) => {
    try { res.json({ data: await refineChapterDetails(req.params.id, parseInt(req.params.sortOrder)) }); } catch (e) { next(e); }
  });

  // State snapshots
  api.get("/novels/:id/snapshots", async (req, res, next) => {
    try { res.json({ data: await getStateSnapshots(req.params.id) }); } catch (e) { next(e); }
  });

  api.use("/novels", novelRoutes);
  api.use("/styles", styleRoutes);
  app.use("/api", api);
}
