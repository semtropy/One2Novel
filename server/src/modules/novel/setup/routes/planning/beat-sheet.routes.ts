/** Beat Sheet routes — generate and retrieve beat sheets for volume chapter rhythms. */
import { Router } from "express";
import { getPrisma } from "../../../../../platform/db/client";
import { generateBeatSheet } from "../../../planning/storyMacro/beatSheetService";

const router = Router();

// Get beat sheet data for a volume (including outline fallback)
router.get("/:novelId/volumes/:sortOrder/beats", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const sortOrder = parseInt(req.params.sortOrder);
    const beats = await getPrisma().volumeChapterPlan.findMany({
      where: { volume: { novelId, sortOrder } },
      orderBy: { chapterOrder: "asc" },
      select: { chapterOrder: true, purpose: true, conflictLevel: true, revealLevel: true, exclusiveEvent: true, endingState: true, mustAvoid: true, targetWordCount: true },
    });
    if (beats.length > 0 && beats.some(b => b.purpose)) {
      res.json({ data: beats });
      return;
    }
    // Fallback: read from structuredOutline (blueprint)
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

// Generate beat sheet for a volume
router.post("/:novelId/volumes/:sortOrder/beats", async (req, res, next) => {
  try {
    const novelId = req.params.novelId;
    const sortOrder = parseInt(req.params.sortOrder);
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

export default router;
