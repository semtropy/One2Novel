import { Router } from "express";
import { listRules, createRule, updateRule, deleteRule, batchGenerateRules, checkConflict, checkAllConflicts, resolveConflict } from "../../modules/novel/world/worldRuleService";

const router = Router();

router.get("/novels/:id/world/rules", async (req, res, next) => {
  try {
    const category = req.query.category as string | undefined;
    res.json({ data: await listRules(req.params.id, category) });
  } catch (e) { next(e); }
});

router.post("/novels/:id/world/rules", async (req, res, next) => {
  try { res.json({ data: await createRule(req.params.id, req.body) }); } catch (e) { next(e); }
});

router.patch("/novels/:id/world/rules/:ruleId", async (req, res, next) => {
  try { res.json({ data: await updateRule(req.params.ruleId, req.body) }); } catch (e) { next(e); }
});

router.delete("/novels/:id/world/rules/:ruleId", async (req, res, next) => {
  try { await deleteRule(req.params.ruleId); res.status(204).send(); } catch (e) { next(e); }
});

router.post("/novels/:id/world/rules/generate", async (req, res, next) => {
  try { res.json({ data: await batchGenerateRules(req.params.id) }); } catch (e) { next(e); }
});

router.post("/novels/:id/world/rules/check-conflicts", async (req, res, next) => {
  try { res.json({ data: await checkAllConflicts(req.params.id) }); } catch (e) { next(e); }
});

router.post("/novels/:id/world/rules/:ruleId/resolve-conflict", async (req, res, next) => {
  try { res.json({ data: await resolveConflict(req.params.ruleId, req.body.resolution) }); } catch (e) { next(e); }
});

export default router;
