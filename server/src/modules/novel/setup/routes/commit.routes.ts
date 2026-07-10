/**
 * Commit Routes — API endpoints for chapter commit and projection management.
 */

import { Router, Request, Response } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import {
  getCommit,
} from "../../production/commit/commitService";
import {
  replayProjections,
  replayAllUnfinished,
} from "../../production/commit/projectionEngine";

const router = Router();

// Helper to extract string from Express params (can be string | string[])
function param(str: string | string[] | undefined): string {
  return Array.isArray(str) ? str[0] ?? '' : (str ?? '');
}

// ─── GET /:novelId/chapters/:chapterId/commit ─────────────

router.get("/:novelId/chapters/:chapterId/commit", async (req: Request, res: Response) => {
  try {
    const chapterId = param(req.params.chapterId);
    const commit = await getCommit(chapterId);

    if (!commit) {
      return res.status(404).json({ error: "Commit not found" });
    }

    return res.json({
      id: commit.id,
      novelId: commit.novelId,
      chapterId: commit.chapterId,
      chapterOrder: commit.chapterOrder,
      qualityScore: commit.qualityScore,
      verdict: commit.verdict,
      status: commit.status,
      projectionStatus: commit.projectionStatus,
      acceptedAt: commit.acceptedAt,
      projectionRuns: commit.projectionRuns,
      createdAt: commit.createdAt,
    });
  } catch (e) {
    logEventError("commit.routes.get", req.params, e);
    return res.status(500).json({ error: "Failed to fetch commit" });
  }
});

// ─── POST /:novelId/chapters/:chapterId/replay-projections ──

router.post("/:novelId/chapters/:chapterId/replay-projections", async (req: Request, res: Response) => {
  try {
    const chapterId = param(req.params.chapterId);
    const novelId = param(req.params.novelId);
    const chapter = await getPrisma().chapter.findUnique({
      where: { id: chapterId },
      select: { order: true },
    });

    if (!chapter) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    const count = await replayProjections(chapterId, novelId, chapter.order);
    return res.json({ replayed: count });
  } catch (e) {
    logEventError("commit.routes.replay", req.params, e);
    return res.status(500).json({ error: "Failed to replay projections" });
  }
});

// ─── POST /:novelId/replay-all-projections ─────────────────

router.post("/:novelId/replay-all-projections", async (req: Request, res: Response) => {
  try {
    const novelId = param(req.params.novelId);
    const count = await replayAllUnfinished(novelId);
    return res.json({ replayed: count });
  } catch (e) {
    logEventError("commit.routes.replayAll", req.params, e);
    return res.status(500).json({ error: "Failed to replay all projections" });
  }
});

// ─── GET /:novelId/projection-status ──────────────────────

router.get("/:novelId/projection-status", async (req: Request, res: Response) => {
  try {
    const novelId = param(req.params.novelId);
    const prisma = getPrisma();

    const stats = await prisma.chapterCommit.groupBy({
      by: ['projectionStatus'] as const,
      where: { novelId, status: 'accepted' },
      _count: { id: true },
    });

    const total = stats.reduce((sum, s) => sum + (s._count.id ?? 0), 0);
    const byStatus: Record<string, number> = {};
    for (const s of stats) {
      byStatus[s.projectionStatus] = s._count.id ?? 0;
    }

    return res.json({
      total,
      byStatus,
      healthy: total - (byStatus.failed ?? 0) - (byStatus['not_started'] ?? 0),
    });
  } catch (e) {
    logEventError("commit.routes.status", req.params, e);
    return res.status(500).json({ error: "Failed to fetch projection status" });
  }
});

export default router;
