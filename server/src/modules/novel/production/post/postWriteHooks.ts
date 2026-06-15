/**
 * Unified post-write hooks — called by ALL chapter-write paths after content is saved.
 *
 * Callers:
 *   - chapterWriter.streamChapter()  (single-chapter SSE)
 *   - directorService.runDirector()  (batch auto-write)
 *
 * All hooks are fire-and-forget — failures are logged and do NOT block the response.
 */

import { getPrisma } from "../../../../platform/db/client";
import { generateChapterSummary } from "../writing/chapterSummary";
import { detectAiTraces } from "../../../style/antiAiDetector";
import { afterChapterSave } from "../../../timeline/timelineService";
import { detectOverduePayoffs } from "../../../payoff/payoffService";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

export function runPostWriteHooks(
  novelId: string,
  chapterId: string,
  content: string,
  chapterOrder: number,
): void {
  const prisma = getPrisma();
  const ctx = { novelId, chapterId, chapterOrder };
  const logErr = (tag: string, e: unknown) => logEventError(`postWrite.${tag}`, ctx, e);

  // 1. Timeline extraction + conflict detection
  afterChapterSave(novelId, chapterId, content, chapterOrder).catch(e => logErr("timeline", e));

  // 2. Chapter summary generation
  generateChapterSummary(novelId, chapterId, content).catch(e => logErr("summary", e));

  // 3. Anti-AI trace detection → AuditReport
  try {
    const aiDetection = detectAiTraces(content);
    if (aiDetection.hits.length > 0) {
      prisma.auditReport.create({
        data: {
          novelId, chapterId, auditType: "style",
          overallScore: 100 - aiDetection.score,
          summary: aiDetection.summary,
          details: JSON.stringify(aiDetection.hits),
          status: aiDetection.score >= 50 ? "failed" : aiDetection.score >= 25 ? "warning" : "passed",
        },
      }).catch(e => logErr("antiAiReport", e));
    }
  } catch { /* best-effort — anti-AI detection is rule-based, can't throw */ }

  // 4. Character state auto-update
  import("./characterStateUpdater").then(m =>
    m.updateCharacterStatesAfterChapter(novelId, content, chapterOrder)
  ).catch(e => logErr("characterState", e));

  // 5. Overdue payoff detection
  detectOverduePayoffs(novelId).catch(e => logErr("payoff", e));

  // 6. Completion guidance (trigger when >80% progress)
  import("./completionGuidance").then(m =>
    m.checkCompletionReadiness(novelId)
  ).then(result => {
    if (result.progressPercent !== null && result.progressPercent >= 80 && result.unresolvedCount > 0) {
      prisma.auditReport.create({
        data: {
          novelId, chapterId, auditType: "completion",
          overallScore: result.readyToComplete ? 90 : 60,
          summary: result.recommendations.slice(0, 3).join("；"),
          details: JSON.stringify(result),
          status: result.readyToComplete ? "passed" : "warning",
        },
      }).catch(e => logErr("completionReport", e));
    }
  }).catch(e => logErr("completion", e));

  // 7. Auto-compress + cross-volume audit when a volume's last chapter is completed
  import("../context/tieredCompressionService").then(async m => {
    const volPlan = await prisma.volumeChapterPlan.findFirst({
      where: { chapterId },
      include: { volume: { select: { sortOrder: true } } },
    });
    if (!volPlan?.volume) return;
    const volumeOrder = volPlan.volume.sortOrder;

    const volumeChapters = await prisma.volumeChapterPlan.findMany({
      where: { volume: { novelId, sortOrder: volumeOrder } },
      select: { chapter: { select: { id: true, chapterStatus: true } } },
    });
    const allCompleted = volumeChapters.every(cp => cp.chapter?.chapterStatus === "completed");
    if (!allCompleted) return;

    m.compressVolume(novelId, volumeOrder).catch(e => logErr("compressVolume", e));
    import("../audit/crossVolumeAuditService").then(audit =>
      audit.auditVolume(novelId, volumeOrder)
    ).catch(e => logErr("crossVolumeAudit", e));
  }).catch(e => logErr("volumeCompletion", e));
}
