/**
 * Cool Point Scheduler — tracks cool point distribution per volume and
 * alerts when certain types are overdue. Ensures long-form novels maintain
 * the prescribed satisfaction rhythm from the architecture template.
 */
import { getPrisma } from "../../../../platform/db/client";
import type { CoolPointType } from "../../planning/architectureEngine/types";

// ─── Types ─────────────────────────────────────────────

export interface CoolPointBudget {
  volumeOrder: number;
  totalChapters: number;
  recipe: Record<CoolPointType, number>;     // Target % for each type
  used: Record<CoolPointType, number>;       // Actually used count
  lastUsed: Partial<Record<CoolPointType, number>>; // Chapter order of last use
  alerts: CoolPointAlert[];
}

export interface CoolPointAlert {
  type: CoolPointType;
  severity: "low" | "medium" | "high";
  message: string;
  chaptersSince: number;
}

export interface CoolPointStatus {
  volumeOrder: number;
  chaptersWritten: number;
  breakdown: Array<{ type: CoolPointType; target: number; actual: number; percentage: number; gap: string }>;
  alerts: CoolPointAlert[];
}

// ─── Public API ─────────────────────────────────────────

/** Get the cool point status for a volume */
export async function getCoolPointStatus(novelId: string, volumeOrder: number): Promise<CoolPointStatus> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Use architecture recipe or default
  const defaultRecipe: Record<CoolPointType, number> = {
    collect: 25, strategy: 25, verify: 20, reveal: 20, upgrade: 10, face_slap: 0,
  };
  let recipe: Record<CoolPointType, number>;
  if (novel.expectationProfile) {
    try {
      const profile = JSON.parse(novel.expectationProfile);
      recipe = profile.coolPointRecipe ?? defaultRecipe;
    } catch { recipe = defaultRecipe; }
  } else {
    recipe = defaultRecipe;
  }

  // Get all chapters in this volume
  const volume = await prisma.volume.findFirst({
    where: { novelId, sortOrder: volumeOrder },
    include: {
      chapterPlans: {
        orderBy: { chapterOrder: "asc" },
        select: {
          chapterOrder: true,
          coolPointType: true,
          chapter: { select: { chapterStatus: true } },
        },
      },
    },
  });
  if (!volume) throw new Error(`Volume ${volumeOrder} not found`);

  const completedChapters = volume.chapterPlans.filter(
    cp => cp.chapter?.chapterStatus === "completed"
  );

  // Count used cool points
  const used: Record<CoolPointType, number> = {
    collect: 0, strategy: 0, verify: 0, reveal: 0, upgrade: 0, face_slap: 0,
  };
  const lastUsed: Partial<Record<CoolPointType, number>> = {};

  for (const cp of completedChapters) {
    if (cp.coolPointType && cp.coolPointType in used) {
      used[cp.coolPointType as CoolPointType]++;
      lastUsed[cp.coolPointType as CoolPointType] = cp.chapterOrder;
    }
  }

  // Generate alerts
  const alerts: CoolPointAlert[] = [];
  const lastChapterOrder = completedChapters[completedChapters.length - 1]?.chapterOrder ?? 0;

  for (const [type, targetPct] of Object.entries(recipe) as [CoolPointType, number][]) {
    if (targetPct <= 0) continue;
    const expected = Math.max(1, Math.round(completedChapters.length * targetPct / 100));
    const actual = used[type] || 0;
    const last = lastUsed[type];
    const chaptersSince = last ? lastChapterOrder - last : lastChapterOrder;

    // Alert if a type hasn't appeared in too many chapters
    const maxGap = type === "verify" || type === "upgrade" ? 8 : type === "reveal" ? 6 : 5;
    if (chaptersSince >= maxGap && completedChapters.length > 0) {
      alerts.push({
        type, severity: chaptersSince >= maxGap * 1.5 ? "high" : "medium",
        message: `「${COOL_POINT_LABELS[type]}」已${chaptersSince}章未出现，建议在接下来的章节中安排`,
        chaptersSince,
      });
    }

    // Alert if actual is significantly below target
    if (completedChapters.length >= 5 && actual < expected * 0.5) {
      alerts.push({
        type, severity: "low",
        message: `「${COOL_POINT_LABELS[type]}」实际${actual}次，目标${expected}次（${targetPct}%），略有不足`,
        chaptersSince,
      });
    }
  }

  // Build breakdown
  const breakdown = (Object.entries(recipe) as [CoolPointType, number][])
    .filter(([, pct]) => pct > 0)
    .map(([type, targetPct]) => {
      const actual = used[type] || 0;
      const expected = Math.max(1, Math.round(completedChapters.length * targetPct / 100));
      const pct = completedChapters.length > 0 ? Math.round(actual / completedChapters.length * 100) : 0;
      return {
        type,
        target: expected,
        actual,
        percentage: pct,
        gap: actual >= expected ? "✓" : `缺${expected - actual}`,
      };
    });

  return {
    volumeOrder,
    chaptersWritten: completedChapters.length,
    breakdown,
    alerts: alerts.sort((a, b) => (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1) - (a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1)),
  };
}

// ─── Labels ────────────────────────────────────────────

const COOL_POINT_LABELS: Record<CoolPointType, string> = {
  collect: "收集快感",
  strategy: "策略推演",
  verify: "验证时刻",
  reveal: "信息揭示",
  upgrade: "升级快感",
  face_slap: "打脸时刻",
};
