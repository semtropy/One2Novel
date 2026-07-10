import { Router } from "express";
import { listRules, createRule, updateRule, deleteRule, batchGenerateRules, checkConflict, checkAllConflicts, resolveConflict } from "../../modules/novel/world/worldRuleService";
import { errorHandlerWrap } from "../../platform/errors/requestErrorHandler";

const router = Router();

router.get("/novels/:id/world/rules", errorHandlerWrap(async (req, res) => {
  const category = req.query.category as string | undefined;
  res.json({ data: await listRules(String(req.params.id), category) });
}));

router.post("/novels/:id/world/rules", errorHandlerWrap(async (req, res) => {
  res.json({ data: await createRule(String(req.params.id), req.body) });
}));

router.patch("/novels/:id/world/rules/:ruleId", errorHandlerWrap(async (req, res) => {
  res.json({ data: await updateRule(String(req.params.ruleId), req.body) });
}));

router.delete("/novels/:id/world/rules/:ruleId", errorHandlerWrap(async (req, res) => {
  await deleteRule(String(req.params.ruleId));
  res.status(204).send();
}));

router.post("/novels/:id/world/rules/generate", errorHandlerWrap(async (req, res) => {
  res.json({ data: await batchGenerateRules(String(req.params.id)) });
}));

router.post("/novels/:id/world/rules/check-conflicts", errorHandlerWrap(async (req, res) => {
  res.json({ data: await checkAllConflicts(String(req.params.id)) });
}));

router.post("/novels/:id/world/rules/:ruleId/resolve-conflict", errorHandlerWrap(async (req, res) => {
  res.json({ data: await resolveConflict(String(req.params.ruleId), req.body.resolution) });
}));

export default router;
