import { Router } from "express";
import novelRoutes from "./novel.routes";
import planningRoutes from "./planning.routes";
import chapterWriteRoutes from "./chapterWrite.routes";
import volumeChapterRoutes from "./volumeChapter.routes";
import chapterEditRoutes from "./chapterEdit.routes";
import characterDepthRoutes from "./characterDepth.routes";
import exportRoutes from "./export.routes";

const router = Router();

// Mount order: specific paths first to avoid route conflicts
router.use(novelRoutes);
router.use(planningRoutes);
router.use(chapterWriteRoutes);
router.use(volumeChapterRoutes);
router.use(chapterEditRoutes);
router.use(characterDepthRoutes);
router.use(exportRoutes);

export default router;
