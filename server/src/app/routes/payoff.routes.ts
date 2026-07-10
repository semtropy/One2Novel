import { Router } from "express";
import { scanChapterForPayoffs, getPayoffs, createPayoff, updatePayoff, deletePayoff } from "../../modules/payoff/payoffService";
import { errorHandlerWrap } from "../../platform/errors/requestErrorHandler";

const router = Router();

// Payoff scanning (triggered after chapter write)
router.post("/novels/:novelId/chapters/:chapterId/payoffs/scan", errorHandlerWrap(async (req, res) => {
  await scanChapterForPayoffs(String(req.params.novelId), String(req.params.chapterId));
  res.json({ data: { ok: true } });
}));

router.get("/novels/:novelId/payoffs", errorHandlerWrap(async (req, res) => {
  res.json({ data: await getPayoffs(String(req.params.novelId)) });
}));

router.post("/novels/:novelId/payoffs", errorHandlerWrap(async (req, res) => {
  const { title, summary, scopeType, targetStartOrder, targetEndOrder } = req.body;
  if (!title) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "title required" } }); return; }
  res.json({ data: await createPayoff(String(req.params.novelId), { title, summary, scopeType, targetStartOrder, targetEndOrder }) });
}));

router.patch("/novels/:novelId/payoffs/:id", errorHandlerWrap(async (req, res) => {
  res.json({ data: await updatePayoff(String(req.params.id), req.body) });
}));

router.delete("/novels/:novelId/payoffs/:id", errorHandlerWrap(async (req, res) => {
  await deletePayoff(String(req.params.id));
  res.status(204).send();
}));

export default router;
