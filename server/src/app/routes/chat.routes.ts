import { Router } from "express";
import { processChatMessage, executeAction } from "../../modules/creativeHub/chatService";

const router = Router();

router.post("/chat", async (req, res, next) => {
  try {
    const { message, novelId } = req.body;
    const result = await processChatMessage(message, novelId);
    res.json({ data: result });
  } catch (e) { next(e); }
});

router.post("/chat/action", async (req, res, next) => {
  try {
    const { action, novelId } = req.body;
    const result = await executeAction(action, novelId);
    res.json({ data: result });
  } catch (e) { next(e); }
});

export default router;
