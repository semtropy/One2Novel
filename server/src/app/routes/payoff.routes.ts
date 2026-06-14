import { Router } from "express";
import { scanChapterForPayoffs, getPayoffs, createPayoff, updatePayoff, deletePayoff } from "../../modules/payoff/payoffService";

const router = Router();

// Payoff scanning (triggered after chapter write)
router.post("/novels/:novelId/chapters/:chapterId/payoffs/scan", async (req, res, next) => {
  try {
    await scanChapterForPayoffs(req.params.novelId, req.params.chapterId);
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

router.get("/novels/:novelId/payoffs", async (req, res, next) => {
  try { res.json({ data: await getPayoffs(req.params.novelId) }); } catch (e) { next(e); }
});

router.post("/novels/:novelId/payoffs", async (req, res, next) => {
  try {
    const { title, summary, scopeType, targetStartOrder, targetEndOrder } = req.body;
    if (!title) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "title required" } }); return; }
    res.json({ data: await createPayoff(req.params.novelId, { title, summary, scopeType, targetStartOrder, targetEndOrder }) });
  } catch (e) { next(e); }
});

router.patch("/novels/:novelId/payoffs/:id", async (req, res, next) => {
  try { res.json({ data: await updatePayoff(req.params.id, req.body) }); } catch (e) { next(e); }
});

router.delete("/novels/:novelId/payoffs/:id", async (req, res, next) => {
  try { await deletePayoff(req.params.id); res.status(204).send(); } catch (e) { next(e); }
});

export default router;
