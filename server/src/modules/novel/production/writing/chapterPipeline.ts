/**
 * Chapter Pipeline — unified single-chapter processing (generate → quality → repair → persist).
 *
 * Used by the SSE manual-write path (chapterWriter.ts), the batch auto-write
 * path (directorService.ts), and the manual save endpoint via writeChapterContent().
 */

import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";
import { buildCharacterProhibitions } from "../quality/characterProhibitions";
import { assembleRepairContext } from "../repair/repairContext";
import { assembleChapterContext } from "../context/contextBlockBuilders";
import { runQualityGate, totalQualityScore } from "../quality/qualityGate";
import { persistQualityScores } from "../quality/qualityPersist";
import { finalizeChapter } from "../audit/finalization";
import { diagnoseWorkspace } from "../revision/revisionService";
import { formatIssuesForRepair, patchRepair, heavyRepair } from "../repair/repairService";
import { createCommit, acceptCommit } from "../commit/commitService";
import { runProjections } from "../commit/projectionEngine";
import { runDataAgent } from "../agents/dataAgent";

export interface ChapterPipelineResult {
  content: string;
  status: "completed" | "needs_repair";
  score: number;
  repairAttempts: number;
}

/**
 * Process a single chapter after content has been generated.
 * Handles quality gate → conditional repair → persist → post-write hooks.
 *
 * @param novelId — Novel ID
 * @param chapterId — Chapter ID
 * @param generatedContent — Raw LLM-generated content
 * @param chapterOrder — Chapter order number
 */
export async function processChapter(
  novelId: string,
  chapterId: string,
  generatedContent: string,
  chapterOrder: number,
): Promise<ChapterPipelineResult> {
  const prisma = getPrisma();

  // Fetch quality gate params + previous chapter context for coherence check
  const [novelGenre, chapterExpectation, charProhibitions, prevChapter, prevCharStates] = await Promise.all([
    prisma.novel.findUnique({ where: { id: novelId }, select: { genre: true } }).then(r => r?.genre ?? null),
    prisma.chapter.findUnique({ where: { id: chapterId }, select: { expectation: true } }).then(r => r?.expectation ?? null),
    buildCharacterProhibitions(novelId).catch(e => { logEventError("pipeline.charProhibitions", { novelId }, e); return undefined; }),
    prisma.chapter.findFirst({
      where: { novelId, order: { lt: chapterOrder }, chapterStatus: { in: ["drafted", "completed"] } },
      orderBy: { order: "desc" },
      select: { content: true, chapterSummary: { select: { summary: true } } },
    }),
    prisma.novelCharacter.findMany({
      where: { novelId },
      select: { name: true, currentStatus: true, currentLocation: true, currentGoal: true },
    }),
  ]);
  const previousChapterSummary = prevChapter?.chapterSummary?.summary ?? null;
  const previousChapterEnding = prevChapter?.content ?? null; // Full previous chapter for coherence
  const characterStateSnapshot = prevCharStates
    .filter(c => c.currentStatus || c.currentLocation)
    .map(c => `${c.name}：${[c.currentStatus, c.currentLocation, c.currentGoal].filter(Boolean).join("；")}`)
    .join("\n") || null;

  let currentContent = generatedContent;
  let finalStatus: "completed" | "needs_repair" = "completed";
  let finalScore = 50;
  let repairAttempts = 0;
  let lastQuality: Awaited<ReturnType<typeof runQualityGate>> | null = null;

  // Quality gate
  let qualityResult: Awaited<ReturnType<typeof runQualityGate>> | null = null;
  try {
    qualityResult = await runQualityGate(currentContent, {
      genre: novelGenre,
      characterProhibitions: charProhibitions,
      chapterExpectation,
      previousChapterSummary,
      previousChapterEnding,
      characterStateSnapshot,
    });
  } catch { qualityResult = null; }
  if (qualityResult) lastQuality = qualityResult;

  const totalScore = qualityResult ? totalQualityScore(qualityResult) : 25;
  finalScore = totalScore;
  const verdict = qualityResult?.verdict ?? "NEEDS_FIX";

  if (verdict === "PASS" || verdict === "WARNING") {
    finalStatus = "completed";
  } else if (verdict === "NEEDS_FIX") {
    repairAttempts++;
    try {
      const repairCtx = await assembleChapterContext(novelId, chapterId);
      const issuesText = formatIssuesForRepair(qualityResult?.issues ?? []) || "提升质量";
      const { systemContext, repairPrompt } = assembleRepairContext(repairCtx, currentContent, issuesText);
      const enrichedIssues = systemContext ? `${systemContext}\n\n${repairPrompt}` : repairPrompt;
      currentContent = totalScore >= 28
        ? await patchRepair(currentContent, enrichedIssues)
        : await heavyRepair(currentContent, enrichedIssues);

      let recheck: Awaited<ReturnType<typeof runQualityGate>> | null = null;
      try {
        recheck = await runQualityGate(currentContent, {
          genre: novelGenre, characterProhibitions: charProhibitions,
          chapterExpectation,
          previousChapterSummary,
          previousChapterEnding,
        });
      } catch { recheck = null; }
      if (recheck) {
        lastQuality = recheck;
        finalScore = totalQualityScore(recheck);
        finalStatus = (recheck.verdict === "PASS" || recheck.verdict === "WARNING") ? "completed" : "needs_repair";
      } else {
        finalStatus = "needs_repair";
      }
    } catch {
      finalStatus = "needs_repair";
    }
  } else {
    finalStatus = "needs_repair";
  }

  // Persist
  await prisma.chapter.update({
    where: { id: chapterId },
    data: {
      content: currentContent,
      chapterStatus: finalStatus === "completed" ? "completed" : "needs_repair",
    },
  });
  if (lastQuality) {
    await persistQualityScores(chapterId, lastQuality, { repairAttempts, finalScore });
  }

  // ── Phase 3: Commit + Projection ──────────────────────────
  let commitId: string | null = null;

  // Upsert: get existing or create new (single DB round-trip via upsert)
  try {
    const commit = await prisma.chapterCommit.upsert({
      where: { chapterId },
      create: {
        novelId,
        chapterId,
        chapterOrder,
        qualityScore: finalScore,
        verdict: lastQuality?.verdict ?? null,
        reviewResult: lastQuality ? JSON.stringify(lastQuality) : null,
        status: 'pending',
        projectionStatus: 'not_started',
      },
      update: {}, // Don't update existing commits
      select: { id: true, status: true },
    });

    if (commit.status === 'accepted') {
      // Already accepted (from a previous run or backfill)
      commitId = commit.id;
    } else {
      // Was just created as pending — accept it
      await acceptCommit(chapterId).catch(e =>
        logEventError("pipeline.acceptCommit", { novelId, chapterId }, e)
      );
      commitId = commit.id;
    }
  } catch (e) {
    logEventError("pipeline.commitUpsert", { novelId, chapterId }, e);
  }

  // ── Phase 4: DataAgent (structured fact extraction) ──────
  // When enabled, extracts structured facts and stores them in the commit.
  // This replaces the separate LLM calls in characterStateUpdater + memoryWriter.
  let extractionResult: Record<string, unknown> | undefined;
  try {
    const dataRun = await runDataAgent(novelId, chapterId, chapterOrder, currentContent);
    if (dataRun.output) {
      extractionResult = dataRun.output;
      // Update the commit with extraction result
      await prisma.chapterCommit.updateMany({
        where: { chapterId, status: 'accepted' },
        data: { extractionResult: JSON.stringify(dataRun.output) },
      }).catch(e => logEventError("pipeline.updateExtraction", { novelId, chapterId }, e));
    }
  } catch (e) {
    logEventError("pipeline.dataAgent", { novelId, chapterId }, e);
  }

  // Dispatch projections (fire-and-forget)
  if (commitId) {
    runProjections(commitId, novelId, chapterId, chapterOrder, currentContent, lastQuality ? (lastQuality as unknown as Record<string, unknown>) : undefined, extractionResult)
      .catch(e => logEventError("pipeline.projections", { novelId, chapterId }, e));
  }

  const ctx = { novelId, chapterId, chapterOrder };

  // Finalization consistency check + diagnosis (fire-and-forget)
  finalizeChapter(novelId, chapterId, chapterOrder).then(r => {
    if (r.consistencyIssues.length > 0) {
      // Return the promise so the outer .catch() can catch sync or async errors
      return getPrisma().auditReport.create({
        data: {
          novelId, chapterId,
          auditType: "finalization",
          overallScore: r.consistencyIssues.filter(i => i.severity === "high").length > 0 ? 50
            : r.consistencyIssues.filter(i => i.severity === "medium").length > 0 ? 70 : 90,
          summary: r.summary,
          details: JSON.stringify(r.consistencyIssues),
        },
      });
    }
  }).catch(e => logEventError("pipeline.finalizationReport", ctx, e));

  if (finalStatus === "completed") {
    diagnoseWorkspace(novelId, chapterId).then(diag => {
      // Return the promise so the outer .catch() can catch sync or async errors
      return getPrisma().chapter.update({
        where: { id: chapterId },
        data: { diagnosis: JSON.stringify(diag) },
      });
    }).catch(e => logEventError("pipeline.diagnosis", ctx, e));
  }

  return { content: currentContent, status: finalStatus, score: Math.round(finalScore), repairAttempts };
}

/**
 * Persist chapter content through the full quality pipeline.
 * Used by the manual save endpoint (PUT /novels/:novelId/chapters/:chapterId/content).
 */
export async function writeChapterContent(
  novelId: string,
  chapterId: string,
  content: string,
): Promise<ChapterPipelineResult> {
  const chapter = await getPrisma().chapter.findUnique({
    where: { id: chapterId },
    select: { order: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  return processChapter(novelId, chapterId, content, chapter.order);
}
