import { novelEventBus } from "../../../platform/events/bus";
import { getPrisma } from "../../../platform/db/client";
import { scanChapterForPayoffs } from "../../payoff/payoffService";
import { updateCharacterDynamics } from "./characterDynamics";
import { scanConflicts } from "./openConflict";
import { logEventError } from "../../../platform/logging/eventErrorLog";

/**
 * Register side-effect handlers for chapter lifecycle events.
 * These run async — they don't block the chapter write response.
 */
export function registerChapterEventHandlers() {
  novelEventBus.on("chapter.drafted", async (payload) => {
    const { novelId, chapterId } = payload as { novelId: string; chapterId: string; wordCount: number };
    try {
      const prisma = getPrisma();
      const chapters = await prisma.chapter.count({ where: { novelId, chapterStatus: { in: ["drafted", "completed"] } } });
      await prisma.novel.update({
        where: { id: novelId },
        data: { estimatedChapterCount: chapters },
      });
      // Side-effects — fire-and-forget with structured error logging
      scanChapterForPayoffs(novelId, chapterId)
        .catch(e => logEventError("chapter.drafted.payoff", { novelId, chapterId }, e));
      updateCharacterDynamics(novelId, chapterId)
        .catch(e => logEventError("chapter.drafted.dynamics", { novelId, chapterId }, e));
      scanConflicts(novelId, chapterId)
        .catch(e => logEventError("chapter.drafted.conflicts", { novelId, chapterId }, e));
      // Timeline extraction happens via afterChapterSave() in both write paths
    } catch (e) {
      logEventError("chapter.drafted", { novelId, chapterId }, e);
    }
  });

  novelEventBus.on("chapter.completed", async (payload) => {
    const { novelId } = payload as { novelId: string; chapterId: string };
    try {
      const prisma = getPrisma();
      const pending = await prisma.chapter.count({
        where: { novelId, chapterStatus: { not: "completed" }, order: { gt: 0 } },
      });
      if (pending === 0) {
        await prisma.novel.update({
          where: { id: novelId },
          data: { projectStatus: "completed" },
        });
      }
    } catch (e) {
      logEventError("chapter.completed", { novelId }, e);
    }
  });
}

// Auto-register on import
registerChapterEventHandlers();
