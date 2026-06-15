import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { streamChapter } from "../../production/writing/chapterWriter";
import { runQualityGate } from "../../production/quality/qualityGate";
import { persistQualityScores } from "../../production/quality/qualityPersist";
import { repairChapter, formatIssuesForRepair } from "../../production/repair/repairService";
import { diagnoseWorkspace } from "../../production/revision/revisionService";
import { optimizeChapterDraft } from "../../production/repair/draftOptimizeService";
import { buildCharacterProhibitions } from "../../production/quality/characterProhibitions";

const router = Router();

// Generate chapter content (SSE)
router.post("/:novelId/chapters/:chapterId/write", async (req, res, next) => {
  try {
    await streamChapter(req.params.novelId, req.params.chapterId, res);
  } catch (e) { next(e); }
});

// Quality gate (non-streaming review)
router.post("/:novelId/chapters/:chapterId/review", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) { res.status(400).json({ error: { code: "NO_CONTENT", message: "Chapter has no content" } }); return; }
    const novel = await prisma.novel.findUnique({ where: { id: req.params.novelId }, select: { genre: true } });
    const characterProhibitions = await buildCharacterProhibitions(req.params.novelId).catch(() => undefined);
    const result = await runQualityGate(chapter.content, {
      genre: novel?.genre,
      characterProhibitions,
      chapterExpectation: chapter.expectation,
    });
    await persistQualityScores(chapter.id, result);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// Repair chapter
router.post("/:novelId/chapters/:chapterId/repair", async (req, res, next) => {
  try {
    const { mode, issues } = req.body;
    const prisma = getPrisma();
    const chapter = await prisma.chapter.findUnique({ where: { id: req.params.chapterId } });
    if (!chapter?.content) { res.status(400).json({ error: { code: "NO_CONTENT" } }); return; }
    const result = await repairChapter(chapter.content, formatIssuesForRepair(issues ?? []));
    if (result && result !== chapter.content) {
      await prisma.chapter.update({ where: { id: req.params.chapterId }, data: { content: result } });
    }
    res.json({ data: { repaired: result !== chapter.content, wordCount: result.length } });
  } catch (e) { next(e); }
});

// Undo
router.post("/:novelId/chapters/:chapterId/undo", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const latestHistory = await prisma.chapterEditHistory.findFirst({
      where: { chapterId: req.params.chapterId },
      orderBy: { createdAt: "desc" },
    });
    if (!latestHistory) { res.json({ data: { restored: false, message: "无历史记录" } }); return; }
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { content: latestHistory.content, scenePlan: latestHistory.sceneState },
    });
    await prisma.chapterEditHistory.delete({ where: { id: latestHistory.id } });
    res.json({ data: { restored: true, ts: latestHistory.createdAt.toISOString(), chars: latestHistory.content.length } });
  } catch (e) { next(e); }
});

// Diagnose workspace
router.post("/:novelId/chapters/:chapterId/diagnose", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const result = await diagnoseWorkspace(req.params.novelId, req.params.chapterId);
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { diagnosis: JSON.stringify(result) },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Draft Optimize (Phase 2.8) ──────────────────────

router.post("/:novelId/chapters/:chapterId/optimize", async (req, res, next) => {
  try {
    const result = await optimizeChapterDraft(req.params.novelId, req.params.chapterId);
    // Save optimized content back to chapter
    const prisma = getPrisma();
    await prisma.chapter.update({
      where: { id: req.params.chapterId },
      data: { content: result.optimizedContent },
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Manual Save (quality-gated) ───────────────────────────

import { writeChapterContent } from "../../production/writing/chapterPipeline";

router.put("/:novelId/chapters/:chapterId/content", async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "content is required" } });
      return;
    }
    const result = await writeChapterContent(req.params.novelId, req.params.chapterId, content);
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Next Chapter Preview (Phase: chapter-by-chapter generation) ──

const NextChapterPreviewSchema = z.object({
  chapterTitle: z.string(), expectation: z.string(), coreEvent: z.string(),
  endingHook: z.string(), coolPointType: z.string().optional(), sceneCount: z.number().int().optional(),
});

router.post("/:novelId/next-chapter-preview", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novelId = req.params.novelId;
    const chapters = await prisma.chapter.findMany({
      where: { novelId, chapterStatus: "completed" },
      orderBy: { order: "desc" },
      take: 3,
      select: { order: true, title: true, content: true, expectation: true },
    });
    if (chapters.length === 0) { res.status(400).json({ error: { code: "NO_CHAPTERS", message: "至少需要一章已完成" } }); return; }

    const lastChapter = chapters[0];
    const lastExcerpt = lastChapter.content?.slice(-500) ?? "";

    // Find current volume context
    const plan = await prisma.volumeChapterPlan.findFirst({
      where: { chapterId: lastChapter.order.toString() },
      select: { volume: { select: { title: true, summary: true } }, loopPhase: true },
    }).catch(() => null);

    const userPrompt = [
      chapters.length > 1 ? `前一章：${chapters[1].title} — ${chapters[1].expectation ?? ""}` : null,
      `上一章结尾：${lastExcerpt}`,
      `上一章标题：${lastChapter.title}`,
      plan?.volume ? `当前卷：${plan.volume.title} — ${plan.volume.summary ?? ""}` : null,
    ].filter(Boolean).join("\n");

    const result = await aiInvoke({
      assetId: "novel.chapter.next-preview",
      userPrompt,
      schema: NextChapterPreviewSchema,
      temperature: 0.8,
      novelId,
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Inline Writing Suggestions ───────────────────────

import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";

const InlineSuggestSchema = z.object({
  suggestion: z.string(), severity: z.enum(["low", "medium"]), focus: z.string(),
});

router.post("/:novelId/chapters/:chapterId/inline-suggest", async (req, res, next) => {
  try {
    const { selectedText } = req.body;
    if (!selectedText || selectedText.length < 50) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "selectedText too short (min 50 chars)" } });
      return;
    }
    const result = await aiInvoke({
      assetId: "novel.chapter.inline-suggest",
      userPrompt: `分析以下段落：\n\n${selectedText.slice(0, 2000)}`,
      schema: InlineSuggestSchema,
      temperature: 0.5,
      novelId: req.params.novelId,
      chapterId: req.params.chapterId,
    });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// ─── Context Preview (for debugging assembled LLM context) ──

router.get("/:novelId/chapters/:chapterId/context-preview", async (req, res, next) => {
  try {
    const { assembleChapterBlocks, fetchAssemblyBase } = await import("../../production/context/contextBlockBuilders");
    const { novel, chapter } = await fetchAssemblyBase(req.params.novelId, req.params.chapterId);
    const blocks = await assembleChapterBlocks(novel as any, chapter as any);
    res.json({ data: { blocks: blocks.map((b: any) => ({ id: b.id, group: b.group, priority: b.priority, required: b.required, contentPreview: (b.content ?? "").slice(0, 300) })) } });
  } catch (e) { next(e); }
});

// ─── Edit History (for diff view) ──────────────────────

router.get("/:novelId/chapters/:chapterId/edit-history", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const history = await prisma.chapterEditHistory.findMany({
      where: { chapterId: req.params.chapterId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, createdAt: true },
      take: 5,
    });
    res.json({ data: history });
  } catch (e) { next(e); }
});

export default router;
