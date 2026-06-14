import { Router } from "express";
import { runDirector, getDirectorProgress, stopDirector, directorEmitter } from "../../modules/novel/director/directorService";
import { loadCheckpoint } from "../../modules/novel/director/checkpointService";
import { getPrisma } from "../../platform/db/client";

const router = Router();

// Auto-Director
router.post("/novels/:novelId/director/run", async (req, res, next) => {
  try {
    const novel = await getPrisma().novel.findUnique({ where: { id: req.params.novelId }, select: { id: true } });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
    runDirector(req.params.novelId, req.body.maxChapters).catch(console.error);
    res.json({ data: { started: true } });
  } catch (e) { next(e); }
});

router.post("/novels/:novelId/director/stop", (req, res) => {
  const stopped = stopDirector(req.params.novelId);
  res.json({ data: { stopped } });
});

router.get("/novels/:novelId/director/progress", (req, res) => {
  res.json({ data: getDirectorProgress(req.params.novelId) });
});

// SSE stream for director progress
router.get("/novels/:novelId/director/stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (evt: string, data: unknown) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
  const novelId = req.params.novelId;
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

// Resume interrupted director run
router.post("/novels/:novelId/director/resume", async (req, res, next) => {
  try {
    const novel = await getPrisma().novel.findUnique({ where: { id: req.params.novelId }, select: { id: true } });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
    const checkpoint = await loadCheckpoint(req.params.novelId);
    if (!checkpoint) {
      res.status(400).json({ error: { code: "NO_CHECKPOINT", message: "没有可恢复的进度" } });
      return;
    }
    const remaining = checkpoint.totalChaptersToWrite - checkpoint.completedChapterIds.length;
    runDirector(req.params.novelId, remaining).catch(console.error);
    res.json({ data: { resumed: true, fromChapter: checkpoint.currentChapterOrder, remaining } });
  } catch (e) { next(e); }
});

export default router;
