/**
 * Hook Density Checker — verifies that each chapter has an effective ending hook,
 * tracks short/medium hook ratios, and flags chapters with weak or missing hooks.
 */
import { getPrisma } from "../../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface HookCheckResult {
  chapterId: string;
  chapterOrder: number;
  hasHook: boolean;
  hookQuality: "strong" | "adequate" | "weak" | "missing";
  issue?: string;
}

export interface HookDensityReport {
  volumeOrder: number;
  totalChapters: number;
  chaptersWithHooks: number;
  chaptersWithoutHooks: number;
  weakHookChapters: number[];
  density: number;                     // 0-1 fraction
  verdict: "good" | "acceptable" | "needs_improvement";
  suggestion: string;
}

// ─── Hook quality heuristics ───────────────────────────

const WEAK_HOOK_PATTERNS = [
  /欲知后事如何.*分解/,
  /预知后事如何/,
  /请听下回分解/,
  /^\s*$/, // Empty ending
];

const STRONG_HOOK_INDICATORS = [
  /突然|忽然|猛地|骤然/,
  /？$/m,  // Ends with a question
  /……$/,
  /——$/,
  /！$/,
  /难道/,
  /不可能/,
  /怎么会/,
  /究竟/,
  /到底/,
];

/**
 * Check hook quality for a single chapter.
 * Heuristic-based: analyzes the chapter's ending text and hook field.
 */
export function checkChapterHook(
  chapterContent: string,
  chapterHook: string | null,
): { hasHook: boolean; hookQuality: "strong" | "adequate" | "weak" | "missing"; issue?: string } {
  // If there's an explicit hook field, it's at least adequate
  if (chapterHook && chapterHook.trim().length > 10) {
    // Check if the hook is too formulaic
    for (const pattern of WEAK_HOOK_PATTERNS) {
      if (pattern.test(chapterHook)) {
        return { hasHook: true, hookQuality: "weak", issue: "钩子过于公式化，建议使用具体悬念而非套话" };
      }
    }
    return { hasHook: true, hookQuality: "adequate" };
  }

  // No explicit hook — check the chapter's last 200 characters
  const ending = chapterContent.slice(-200).trim();
  if (!ending || ending.length < 20) {
    return { hasHook: false, hookQuality: "missing", issue: "章节结尾太短，可能缺少有效的悬念钩子" };
  }

  // Check for hook indicators in the ending
  let indicatorScore = 0;
  for (const indicator of STRONG_HOOK_INDICATORS) {
    if (indicator.test(ending)) indicatorScore++;
  }

  if (indicatorScore >= 2) {
    return { hasHook: true, hookQuality: "strong" };
  } else if (indicatorScore >= 1) {
    return { hasHook: true, hookQuality: "adequate" };
  } else {
    return { hasHook: false, hookQuality: "weak", issue: "章节结尾缺乏悬念元素，建议添加具体钩子（突发/疑问/反转）" };
  }
}

/**
 * Check hook density for a volume.
 */
export async function checkVolumeHookDensity(
  novelId: string,
  volumeOrder: number,
): Promise<HookDensityReport> {
  const prisma = getPrisma();
  const volume = await prisma.volume.findFirst({
    where: { novelId, sortOrder: volumeOrder },
    include: {
      chapterPlans: {
        orderBy: { chapterOrder: "asc" },
        select: {
          chapterOrder: true,
          endingState: true, // hook text
          chapter: { select: { id: true, content: true, chapterStatus: true, hook: true } },
        },
      },
    },
  });
  if (!volume) throw new Error(`Volume ${volumeOrder} not found`);

  const completedPlans = volume.chapterPlans.filter(
    cp => cp.chapter?.chapterStatus === "completed"
  );

  const hookResults: HookCheckResult[] = completedPlans.map(cp => {
    const content = cp.chapter?.content ?? "";
    const hook = cp.chapter?.hook ?? cp.endingState ?? null;
    const check = checkChapterHook(content, hook);
    return {
      chapterId: cp.chapter?.id ?? "",
      chapterOrder: cp.chapterOrder,
      hasHook: check.hasHook,
      hookQuality: check.hookQuality,
      issue: check.issue,
    };
  });

  const chaptersWithHooks = hookResults.filter(r => r.hasHook).length;
  const chaptersWithoutHooks = hookResults.filter(r => !r.hasHook).length;
  const weakHookChapters = hookResults
    .filter(r => r.hookQuality === "weak" || r.hookQuality === "missing")
    .map(r => r.chapterOrder);
  const density = completedPlans.length > 0 ? chaptersWithHooks / completedPlans.length : 1;

  let verdict: HookDensityReport["verdict"];
  let suggestion: string;

  if (density >= 0.9 && weakHookChapters.length === 0) {
    verdict = "good";
    suggestion = "钩子覆盖率良好，继续保持。";
  } else if (density >= 0.8 && weakHookChapters.length <= 2) {
    verdict = "acceptable";
    suggestion = `第${weakHookChapters.join("、")}章钩子较弱，建议在修订时加强。`;
  } else {
    verdict = "needs_improvement";
    const consecutive = findConsecutive(weakHookChapters);
    suggestion = consecutive.length >= 2
      ? `连续第${consecutive.join("、")}章缺少有效钩子，读者可能流失。建议立即在这些章结尾添加悬念。`
      : `${chaptersWithoutHooks}章缺少钩子，建议逐一检查。`;
  }

  return {
    volumeOrder,
    totalChapters: completedPlans.length,
    chaptersWithHooks,
    chaptersWithoutHooks,
    weakHookChapters,
    density,
    verdict,
    suggestion,
  };
}

/** Find consecutive numbers in an array */
function findConsecutive(nums: number[]): number[] {
  if (nums.length < 2) return nums;
  const sorted = [...nums].sort((a, b) => a - b);
  let best: number[] = [];
  let current: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current.push(sorted[i]);
    } else {
      if (current.length > best.length) best = current;
      current = [sorted[i]];
    }
  }
  if (current.length > best.length) best = current;
  return best.length >= 2 ? best : [];
}
