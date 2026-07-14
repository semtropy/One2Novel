/**
 * Post-Write Bus — registers chapter post-write side-effect handlers
 * that are NOT covered by the projection engine.
 *
 * Handlers replaced by projection writers (summary, RAG/vector, character
 * state, memory) run exclusively from the commit pipeline and have been
 * removed from this bus.
 *
 * Remaining handlers:
 *   - Timeline extraction
 *   - Payoff detection
 *   - Volume compression
 *   - Anti-AI trace detection
 *   - Completion guidance
 *   - Volume completion (compress + cross-volume audit)
 *   - Debt interest accrual
 *
 * Callers:
 *   - chapterWriter.streamChapter()  (single-chapter SSE)
 *   - directorService.runDirector()  (batch auto-write)
 *   - chapterPipeline.processChapter() (quality-gated path)
 *
 * All handlers are fire-and-forget — failures are logged and do NOT block.
 */

import { novelEventBus } from "../../../../platform/events/bus";
import { getPrisma } from "../../../../platform/db/client";
import { detectAiTraces } from "../../../style/antiAiDetector";
import { afterChapterSave } from "../../../timeline/timelineService";
import { detectOverduePayoffs } from "../../../payoff/payoffService";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { Semaphore } from "../../../../platform/concurrency/semaphore";
import { POST_WRITE_MAX_CONCURRENT } from "../../../../platform/config/constants";

// ─── Handler: Timeline extraction ──────────────────────────

async function handleTimeline(ctx: { novelId: string; chapterId: string; chapterOrder: number; content: string }) {
  afterChapterSave(ctx.novelId, ctx.chapterId, ctx.content, ctx.chapterOrder)
    .catch(e => logEventError("postWrite.timeline", ctx, e));
}

// ─── Handler: Volume incremental compression ───────────────

async function handleVolumeCompress(ctx: { novelId: string; chapterOrder: number }) {
  try {
    const m = await import("../context/volumeCompressor");
    m.maybeCompressIncremental(ctx.novelId, ctx.chapterOrder)
      .catch(e => logEventError("postWrite.volumeCompress", ctx, e));
  } catch (e) {
    logEventError("postWrite.volumeCompress", ctx, e);
  }
}

// ─── Handler: Anti-AI trace detection ──────────────────────

async function handleAntiAi(ctx: { novelId: string; chapterId: string; content: string }) {
  const prisma = getPrisma();
  try {
    const aiDetection = detectAiTraces(ctx.content);
    if (aiDetection.hits.length > 0) {
      await prisma.auditReport.create({
        data: {
          novelId: ctx.novelId, chapterId: ctx.chapterId, auditType: "style",
          overallScore: 100 - aiDetection.score,
          summary: aiDetection.summary,
          details: JSON.stringify(aiDetection.hits),
          status: aiDetection.score >= 50 ? "failed" : aiDetection.score >= 25 ? "warning" : "passed",
        },
      });
    }
  } catch (e) {
    logEventError("postWrite.antiAi", ctx, e);
  }
}

// ─── Handler: Overdue payoff detection ─────────────────────

async function handlePayoff(ctx: { novelId: string }) {
  detectOverduePayoffs(ctx.novelId)
    .catch(e => logEventError("postWrite.payoff", ctx, e));
}

// ─── Handler: Completion guidance ──────────────────────────

async function handleCompletionGuidance(ctx: { novelId: string; chapterId: string }) {
  const prisma = getPrisma();
  try {
    const m = await import("./completionGuidance");
    const result = await m.checkCompletionReadiness(ctx.novelId);
    if (result.progressPercent !== null && result.progressPercent >= 80 && result.unresolvedCount > 0) {
      await prisma.auditReport.create({
        data: {
          novelId: ctx.novelId, chapterId: ctx.chapterId, auditType: "completion",
          overallScore: result.readyToComplete ? 90 : 60,
          summary: result.recommendations.slice(0, 3).join("；"),
          details: JSON.stringify(result),
          status: result.readyToComplete ? "passed" : "warning",
        },
      });
    }
  } catch (e) {
    logEventError("postWrite.completion", ctx, e);
  }
}

// ─── Handler: Volume completion → compress + cross-volume audit ──

async function handleVolumeCompletion(ctx: { novelId: string; chapterId: string; chapterOrder: number }) {
  const prisma = getPrisma();
  try {
    const volPlan = await prisma.volumeChapterPlan.findFirst({
      where: { chapterId: ctx.chapterId },
      include: { volume: { select: { sortOrder: true } } },
    });
    if (!volPlan?.volume) return;
    const volumeOrder = volPlan.volume.sortOrder;

    const volumeChapters = await prisma.volumeChapterPlan.findMany({
      where: { volume: { novelId: ctx.novelId, sortOrder: volumeOrder } },
      select: { chapter: { select: { id: true, chapterStatus: true } } },
    });
    const allCompleted = volumeChapters.every(cp => cp.chapter?.chapterStatus === "completed");
    if (!allCompleted) return;

    const m = await import("../context/tieredCompressionService");
    m.compressVolume(ctx.novelId, volumeOrder)
      .catch(e => logEventError("postWrite.compressVolume", ctx, e));

    import("../audit/crossVolumeAuditService").then(audit =>
      audit.auditVolume(ctx.novelId, volumeOrder)
        .catch(e => logEventError("postWrite.crossVolumeAudit", ctx, e))
    ).catch(e => logEventError("postWrite.crossVolumeImport", ctx, e)); // intentional: fire-and-forget, failure tolerated
  } catch (e) {
    logEventError("postWrite.volumeCompletion", ctx, e);
  }
}

// ─── Handler: Debt interest accrual ────────────────────────

async function handleDebtInterest(ctx: { novelId: string; chapterOrder: number }) {
  try {
    const { accrueInterest } = await import("../debtService");
    accrueInterest(ctx.novelId, ctx.chapterOrder)
      .catch(e => logEventError("postWrite.debtInterest", ctx, e));
  } catch (e) {
    logEventError("postWrite.debtInterest", ctx, e);
  }
}

// ─── Concurrency Control ───────────────────────────────────

/** Semaphore to limit concurrent post-write handler execution */
const postWriteSemaphore = new Semaphore(POST_WRITE_MAX_CONCURRENT);

// ─── Registration ──────────────────────────────────────────

/**
 * Register remaining post-write handlers on the novelEventBus.
 * Called once at application startup.
 */
export function registerPostWriteHandlers(): void {
  novelEventBus.on("postWrite.chapterSaved", async (payload) => {
    const ctx = payload as {
      novelId: string; chapterId: string; chapterOrder: number; content: string;
    };
    const logErr = (tag: string, e: unknown) => logEventError(`postWrite.${tag}`, ctx, e);

    // Run all handlers in parallel with concurrency control.
    // Each handler acquires a semaphore slot before executing,
    // preventing SQLite lock contention during Director batch writes.
    const throttled = (fn: () => Promise<unknown>, tag: string) => async () => {
      await postWriteSemaphore.acquire();
      try {
        return await fn();
      } finally {
        postWriteSemaphore.release();
      }
    };

    Promise.allSettled([
      throttled(() => handleTimeline(ctx).catch(e => logErr("timeline", e)), "timeline"),
      throttled(() => handleVolumeCompress({ novelId: ctx.novelId, chapterOrder: ctx.chapterOrder }).catch(e => logErr("volumeCompress", e)), "volumeCompress"),
      throttled(() => handleAntiAi({ novelId: ctx.novelId, chapterId: ctx.chapterId, content: ctx.content }).catch(e => logErr("antiAi", e)), "antiAi"),
      throttled(() => handlePayoff({ novelId: ctx.novelId }).catch(e => logErr("payoff", e)), "payoff"),
      throttled(() => handleCompletionGuidance({ novelId: ctx.novelId, chapterId: ctx.chapterId }).catch(e => logErr("completion", e)), "completion"),
      throttled(() => handleVolumeCompletion({ novelId: ctx.novelId, chapterId: ctx.chapterId, chapterOrder: ctx.chapterOrder }).catch(e => logErr("volumeCompletion", e)), "volumeCompletion"),
      throttled(() => handleDebtInterest({ novelId: ctx.novelId, chapterOrder: ctx.chapterOrder }).catch(e => logErr("debtInterest", e)), "debtInterest"),
    ]);
  });
}

// ─── Public interface ──────────────────────────────────────

/**
 * Emit the chapter-saved event. All registered handlers run fire-and-forget.
 *
 * This is the module's sole public interface. The implementation
 * (7 handlers across 7 modules) is hidden behind one call.
 */
export function runPostWriteHooks(
  novelId: string,
  chapterId: string,
  content: string,
  chapterOrder: number,
): void {
  novelEventBus.emit("postWrite.chapterSaved", { novelId, chapterId, chapterOrder, content });
}

// Auto-register on import
registerPostWriteHandlers();
