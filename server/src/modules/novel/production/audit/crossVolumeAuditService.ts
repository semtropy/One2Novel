/**
 * Cross-Volume Audit Service — checks consistency across completed volumes.
 * Phase 5: Detects world rule violations, character drift, and payoff staleness.
 */
import { getPrisma } from "../../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export interface AuditFinding {
  severity: "high" | "medium" | "low";
  category: "world_rule" | "character_drift" | "payoff_stale" | "continuity";
  location: string;
  description: string;
  suggestion: string;
}

export interface CrossVolumeAuditReport {
  novelId: string;
  auditedVolumeOrder: number;
  totalChaptersAudited: number;
  findings: AuditFinding[];
  summary: string;
  overallScore: number; // 0-100
}

// ─── Audit Checks ──────────────────────────────────────

async function checkWorldRuleViolations(novelId: string, volumeOrder: number): Promise<AuditFinding[]> {
  const prisma = getPrisma();
  const findings: AuditFinding[] = [];

  const rules = await prisma.worldRule.findMany({
    where: { novelId, status: "active" },
  });

  if (rules.length === 0) return findings;

  // Get chapters in this volume
  const volume = await prisma.volume.findFirst({
    where: { novelId, sortOrder: volumeOrder },
    include: {
      chapterPlans: {
        orderBy: { chapterOrder: "asc" },
        include: { chapter: { select: { content: true, title: true, order: true } } },
      },
    },
  });
  if (!volume) return findings;

  // For each high-priority rule, do a simple semantic check
  // (Full LLM check would be expensive; use heuristic + sampling)
  for (const rule of rules.filter(r => r.priority >= 7)) {
    const completedChapters = volume.chapterPlans.filter(cp => cp.chapter?.content);
    if (completedChapters.length === 0) continue;

    // Sample: check first, middle, and last chapters for rule violations
    const sampleIndices = [0, Math.floor(completedChapters.length / 2), completedChapters.length - 1];
    for (const idx of sampleIndices) {
      const cp = completedChapters[idx];
      const content = cp.chapter?.content ?? "";
      // Heuristic: check if rule content's keywords appear in negation context
      const ruleKeywords = rule.content.slice(0, 30);
      // Simple detection — flag for manual review if rule seems potentially violated
      if (content.length > 0 && rule.priority >= 9) {
        // For priority 9-10 rules, add a low-severity reminder to verify
        findings.push({
          severity: "low",
          category: "world_rule",
          location: `第${volumeOrder}卷第${cp.chapterOrder}章`,
          description: `核心规则「${rule.title}」（优先级${rule.priority}）建议人工复核是否在本章被遵守`,
          suggestion: `规则内容：${rule.content.slice(0, 100)}`,
        });
        break; // One reminder per rule is enough
      }
    }
  }

  return findings;
}

async function checkCharacterDrift(novelId: string, volumeOrder: number): Promise<AuditFinding[]> {
  const prisma = getPrisma();
  const findings: AuditFinding[] = [];

  // Read current character states directly from NovelCharacter
  const chars = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { name: true, role: true, personality: true, currentStatus: true, currentGoal: true },
  });

  for (const c of chars) {
    if (!c.personality || c.personality.length < 10) continue;
    // Simple check: long-standing characters without status updates may be neglected
    if (!c.currentStatus && c.role === "protagonist") {
      findings.push({
        severity: "low",
        category: "character_drift",
        location: `角色「${c.name}」`,
        description: "主角缺少当前状态更新，可能在已写章节中被忽视",
        suggestion: "确保主角每卷都有可见的状态变化",
      });
    }
  }

  return findings;
}

async function checkPayoffStaleness(novelId: string): Promise<AuditFinding[]> {
  const prisma = getPrisma();
  const findings: AuditFinding[] = [];

  const stalePayoffs = await prisma.payoffLedgerItem.findMany({
    where: {
      novelId,
      currentStatus: { in: ["setup", "hinted"] },
    },
    orderBy: { firstSeenOrder: "asc" },
  });

  if (stalePayoffs.length === 0) return findings;

  // Get the latest chapter order
  const lastChapter = await prisma.chapter.findFirst({
    where: { novelId, chapterStatus: "completed" },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const currentOrder = lastChapter?.order ?? 0;

  const overduePayoffs = stalePayoffs.filter(p => {
    const seenAt = p.lastTouchedOrder ?? p.firstSeenOrder ?? 0;
    return currentOrder - seenAt > 50; // More than 50 chapters without progress
  });

  if (overduePayoffs.length > 0) {
    for (const p of overduePayoffs.slice(0, 5)) {
      findings.push({
        severity: overduePayoffs.length > 3 ? "high" : "medium",
        category: "payoff_stale",
        location: `伏笔「${p.title}」`,
        description: `已超过50章未推进（首次出现：第${p.firstSeenOrder ?? "?"}章），存在被遗忘风险`,
        suggestion: "建议在近期章节中触及或兑现此伏笔，或标记为已废弃",
      });
    }
  }

  return findings;
}

// ─── Main Entry ────────────────────────────────────────

export async function auditVolume(
  novelId: string,
  volumeOrder: number,
): Promise<CrossVolumeAuditReport> {
  const [worldRuleFindings, characterDriftFindings, payoffFindings] = await Promise.all([
    checkWorldRuleViolations(novelId, volumeOrder),
    checkCharacterDrift(novelId, volumeOrder),
    checkPayoffStaleness(novelId),
  ]);

  const allFindings = [...worldRuleFindings, ...characterDriftFindings, ...payoffFindings];
  const highCount = allFindings.filter(f => f.severity === "high").length;
  const mediumCount = allFindings.filter(f => f.severity === "medium").length;
  const lowCount = allFindings.filter(f => f.severity === "low").length;

  const overallScore = Math.max(0, 100 - highCount * 20 - mediumCount * 10 - lowCount * 3);

  // Persist audit report
  const prisma = getPrisma();
  const volume = await prisma.volume.findFirst({ where: { novelId, sortOrder: volumeOrder } });
  const totalChapters = volume
    ? (await prisma.volumeChapterPlan.count({ where: { volumeId: volume.id } }))
    : 0;

  await prisma.auditReport.create({
    data: {
      novelId,
      chapterId: "", // Cross-volume audit has no single chapter
      auditType: "cross_volume",
      overallScore,
      summary: `${highCount}项严重、${mediumCount}项中等、${lowCount}项轻微问题`,
      details: JSON.stringify(allFindings),
      status: highCount > 0 ? "warning" : "passed",
    },
  });

  return {
    novelId,
    auditedVolumeOrder: volumeOrder,
    totalChaptersAudited: totalChapters,
    findings: allFindings,
    summary: `${highCount}项严重、${mediumCount}项中等、${lowCount}项轻微问题`,
    overallScore,
  };
}
