import { novelEventBus } from "../../../platform/events/bus";
import { getPrisma } from "../../../platform/db/client";
import { scanChapterForPayoffs } from "../../payoff/payoffService";
import { updateCharacterDynamics } from "./characterDynamics";
import { scanConflicts } from "./openConflict";
// Timeline extraction moved to afterChapterSave() — called directly by both write paths

/**
 * Register side-effect handlers for chapter lifecycle events.
 * These run async — they don't block the chapter write response.
 */
export function registerChapterEventHandlers() {
  novelEventBus.on("chapter.drafted", async (payload) => {
    const { novelId, chapterId } = payload as { novelId: string; chapterId: string; wordCount: number };
    try {
      const prisma = getPrisma();
      // Update chapter counts on novel
      const chapters = await prisma.chapter.count({ where: { novelId, chapterStatus: { in: ["drafted", "completed"] } } });
      await prisma.novel.update({
        where: { id: novelId },
        data: { estimatedChapterCount: chapters },
      });
      // M3: Async side-effects with proper error logging
      scanChapterForPayoffs(novelId, chapterId).catch(e => console.error("[payoff scan]", e instanceof Error ? e.message : e));
      updateCharacterDynamics(novelId, chapterId).catch(e => console.error("[char dynamics]", e instanceof Error ? e.message : e));
      scanConflicts(novelId, chapterId).catch(e => console.error("[conflict scan]", e instanceof Error ? e.message : e));
      // Timeline extraction: now handled by afterChapterSave() called directly in chapterWriter + directorService
    } catch (e) {
      console.error("[Event:chapter.drafted]", e instanceof Error ? e.message : e);
    }
  });

  novelEventBus.on("chapter.completed", async (payload) => {
    const { novelId } = payload as { novelId: string; chapterId: string };
    try {
      // Update project status if all chapters done
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
      console.error("[Event:chapter.completed]", e instanceof Error ? e.message : e);
    }
  });
}

// Auto-register on import
registerChapterEventHandlers();
