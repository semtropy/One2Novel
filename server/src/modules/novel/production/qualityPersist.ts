import { getPrisma } from "../../../platform/db/client";
import type { QualityResult } from "./qualityGate";

/**
 * Persist 9-dimension quality scores + overall qualityScore + repairHistory to Chapter.
 * Used by both POST /review and director auto-write flow.
 */
export async function persistQualityScores(
  chapterId: string,
  result: QualityResult,
  extra?: { repairAttempts?: number; finalScore?: number },
): Promise<void> {
  const prisma = getPrisma();

  const totalScore = result.openingScore + result.plotScore + result.characterScore
    + result.dialogueScore + result.suspenseScore + result.pacingScore
    + result.showNotTellScore + result.languageScore + (result.genreScore ?? 0)
    + (result.coherenceScore ?? 0);

  await prisma.chapter.update({
    where: { id: chapterId },
    data: {
      openingScore: result.openingScore,
      plotScore: result.plotScore,
      characterScore: result.characterScore,
      dialogueScore: result.dialogueScore,
      suspenseScore: result.suspenseScore,
      pacingScore: result.pacingScore,
      showNotTellScore: result.showNotTellScore,
      languageScore: result.languageScore,
      genreScore: result.genreScore,
      coherenceScore: result.coherenceScore,
      qualityScore: totalScore,
      repairHistory: JSON.stringify({
        ...(extra?.repairAttempts != null ? { attempts: extra.repairAttempts, finalScore: extra.finalScore } : {}),
        overallComment: result.overallComment,
        issues: result.issues ?? [],
      }),
    },
  });
}
