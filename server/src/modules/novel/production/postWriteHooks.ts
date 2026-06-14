/**
 * Unified post-write hooks — called by ALL chapter-write paths after content is saved.
 *
 * Callers:
 *   - chapterWriter.streamChapter()  (single-chapter SSE)
 *   - directorService.runDirector()  (batch auto-write)
 *
 * All hooks are fire-and-forget — failures are logged and do NOT block the response.
 */

import { getPrisma } from "../../../platform/db/client";
import { generateChapterSummary } from "./chapterSummary";
import { detectAiTraces } from "../../style/antiAiDetector";
import { afterChapterSave } from "../../timeline/timelineService";
import { detectOverduePayoffs } from "../../payoff/payoffService";
import { logEventError } from "../../../platform/logging/eventErrorLog";

export function runPostWriteHooks(
  novelId: string,
  chapterId: string,
  content: string,
  chapterOrder: number,
): void {
  const prisma = getPrisma();

  // 1. Timeline extraction + conflict detection
  afterChapterSave(novelId, chapterId, content, chapterOrder).catch(() => {});

  // 2. Chapter summary generation
  generateChapterSummary(novelId, chapterId, content).catch(() => {});

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
      }).catch(() => {});
    }
  } catch { /* best-effort */ }

  // 4. Character state auto-update
  import("./characterStateUpdater").then(m =>
    m.updateCharacterStatesAfterChapter(novelId, content, chapterOrder)
  ).catch(e => logEventError("postWrite.characterState", { novelId, chapterOrder }, e));

  // 5. Overdue payoff detection
  detectOverduePayoffs(novelId).catch(() => {});
}
