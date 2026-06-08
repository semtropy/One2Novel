/**
 * Story Macro Constraint Engine — validates outline structural integrity.
 *
 * ADAPTED from OP storyMacroConstraintEngine.ts (247 lines).
 * Streamlined for One2Novel's outline model:
 *   premise + mainArc + mysteryBox + endingDirection + volumes[].chapters[]
 *
 * Validation dimensions:
 *   1. Conflict continuity — does the conflict engine sustain across volumes?
 *   2. Pacing rhythm — are conflict/reveal levels distributed properly?
 *   3. Volume connectivity — do volumes connect with proper bridges?
 *   4. Hook coherence — do chapter hooks form a readable chain?
 */

// ─── Types ─────────────────────────────────────────────

export interface StoryOutline {
  premise: string;
  mainArc: string;
  mysteryBox: string;
  endingDirection: string;
  volumes: VolumeOutline[];
}

export interface VolumeOutline {
  sortOrder: number;
  title: string;
  summary: string;
  chapters: ChapterOutline[];
}

export interface ChapterOutline {
  order: number;
  title: string;
  summary: string;
  coreEvent: string;
  hook: string;
  conflictLevel: number;
  revealLevel: number;
}

export interface ConstraintViolation {
  severity: "high" | "medium" | "low";
  category: string;
  location: string;       // e.g. "第2卷第5章"
  description: string;
  suggestion: string;
}

export interface ValidationReport {
  passed: boolean;
  violations: ConstraintViolation[];
  warnings: string[];
  summary: string;
}

// ─── Detection helpers ─────────────────────────────────

function isEmpty(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function chaptersOf(outline: StoryOutline): ChapterOutline[] {
  return outline.volumes.flatMap(v => v.chapters);
}

function chapterLabel(vol: VolumeOutline, ch: ChapterOutline): string {
  return `第${vol.sortOrder}卷第${ch.order}章《${ch.title}》`;
}

// ─── Validation checks ─────────────────────────────────

/** 1. Conflict continuity: check that conflict levels form a reasonable curve */
function checkConflictContinuity(outline: StoryOutline): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const chapters = chaptersOf(outline);
  if (chapters.length < 3) return violations;

  // Check for flat conflict (all same level)
  const levels = chapters.map(c => c.conflictLevel);
  const uniqueLevels = new Set(levels);
  if (uniqueLevels.size <= 1 && chapters.length >= 4) {
    violations.push({
      severity: "high",
      category: "冲突曲线平坦",
      location: "全书",
      description: `全部${chapters.length}章冲突等级均为${levels[0]}，缺乏起伏。`,
      suggestion: "确保冲突有升级→缓解→再升级的波浪节奏。建议至少将高潮章设为8-10，过渡章设为4-6。",
    });
  }

  // Check for consecutive 3+ flat chapters
  let flatStart = -1;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] === levels[i - 1]) {
      if (flatStart < 0) flatStart = i - 1;
      if (i - flatStart >= 2) {
        const vol = findVolumeForChapter(outline, chapters[i]);
        violations.push({
          severity: "medium",
          category: "连续平淡",
          location: vol ? chapterLabel(vol, chapters[i]) : `第${i + 1}章`,
          description: `第${flatStart + 1}-${i + 1}章冲突等级连续相同(${levels[i]})，读者可能失去紧张感。`,
          suggestion: "在连续3章持平后插入一个冲突升级点或转折事件。",
        });
        flatStart = -1; // Reset after reporting
      }
    } else {
      flatStart = -1;
    }
  }

  return violations;
}

/** 2. Pacing rhythm: reveal levels should have peaks at volume boundaries */
function checkPacingRhythm(outline: StoryOutline): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const vol of outline.volumes) {
    if (vol.chapters.length < 2) continue;

    // First chapter of each volume should have some reveal
    const firstCh = vol.chapters[0];
    const lastCh = vol.chapters[vol.chapters.length - 1];

    if (lastCh.revealLevel < 6) {
      violations.push({
        severity: "low",
        category: "卷尾揭示不足",
        location: chapterLabel(vol, lastCh),
        description: `卷尾章揭示等级为${lastCh.revealLevel}，可能缺乏卷末冲击力。`,
        suggestion: "每卷结尾应有一个信息揭示或事件转折，揭示等级建议≥6。",
      });
    }

    // Volume should have at least one high-conflict chapter
    const maxConflict = Math.max(...vol.chapters.map(c => c.conflictLevel));
    if (maxConflict < 6) {
      violations.push({
        severity: "medium",
        category: "卷内冲突不足",
        location: `第${vol.sortOrder}卷《${vol.title}》`,
        description: `该卷最高冲突等级仅${maxConflict}，可能缺乏戏剧张力。`,
        suggestion: "确保每卷至少有一个冲突等级≥7的高潮章。",
      });
    }

    // Check reveal information density — shouldn't reveal too much too early
    const firstHalf = vol.chapters.slice(0, Math.ceil(vol.chapters.length / 2));
    const secondHalf = vol.chapters.slice(Math.ceil(vol.chapters.length / 2));
    const avgFirst = firstHalf.reduce((s, c) => s + c.revealLevel, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, c) => s + c.revealLevel, 0) / (secondHalf.length || 1);
    if (avgFirst > avgSecond + 2) {
      violations.push({
        severity: "low",
        category: "信息释放过早",
        location: `第${vol.sortOrder}卷《${vol.title}》`,
        description: `前半卷平均揭示(${avgFirst.toFixed(1)})高于后半卷(${avgSecond.toFixed(1)})，信息密度前重后轻。`,
        suggestion: "将部分关键揭示后移到卷后半段，保持读者好奇心的持续牵引。",
      });
    }
  }

  return violations;
}

/** 3. Volume connectivity: check that volumes are linked */
function checkVolumeConnectivity(outline: StoryOutline): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (let i = 0; i < outline.volumes.length - 1; i++) {
    const current = outline.volumes[i];
    const next = outline.volumes[i + 1];

    // Check if last chapter of current volume has a hook
    const lastCh = current.chapters[current.chapters.length - 1];
    if (lastCh && isEmpty(lastCh.hook)) {
      violations.push({
        severity: "medium",
        category: "卷间断裂",
        location: chapterLabel(current, lastCh),
        description: `该卷最后一章缺少悬念钩子，与下一卷《${next.title}》之间缺乏衔接。`,
        suggestion: "为每卷最后一章添加明确的悬念钩子，确保读者想继续看下一卷。",
      });
    }
  }

  return violations;
}

/** 4. Hook chain coherence: validate hooks form a readable thread */
function checkHookCoherence(outline: StoryOutline): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const chapters = chaptersOf(outline);
  if (chapters.length < 2) return violations;

  // Check for repeated hook patterns (same hook text reused)
  const hookTexts = chapters.map(c => c.hook?.trim() ?? "");
  const seen = new Map<string, number>();
  for (let i = 0; i < hookTexts.length; i++) {
    const h = hookTexts[i];
    if (!h) {
      // Missing hook
      const vol = findVolumeForChapter(outline, chapters[i]);
      violations.push({
        severity: "low",
        category: "缺少钩子",
        location: vol ? chapterLabel(vol, chapters[i]) : `第${i + 1}章`,
        description: "该章未设置悬念钩子，读者可能在此处停止阅读。",
        suggestion: "为每章设置一个明确的悬念钩子（可使用章尾悬念十三式）。",
      });
      continue;
    }
    const prev = seen.get(h);
    if (prev !== undefined) {
      const vol = findVolumeForChapter(outline, chapters[i]);
      violations.push({
        severity: "low",
        category: "钩子重复",
        location: vol ? chapterLabel(vol, chapters[i]) : `第${i + 1}章`,
        description: `该章钩子与第${prev + 1}章重复，降低新鲜感。`,
        suggestion: "每章钩子应有独特性，避免使用相同的悬念模式。",
      });
    }
    seen.set(h, i);
  }

  return violations;
}

/** 5. Structural completeness: core fields must be present */
function checkStructuralCompleteness(outline: StoryOutline): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (isEmpty(outline.premise)) {
    violations.push({
      severity: "high", category: "结构缺失", location: "大纲",
      description: "缺少前提(premise)——故事的根本驱动力未定义。",
      suggestion: "前提应回答'这个故事为什么能开始'，80-150字。",
    });
  }
  if (isEmpty(outline.mainArc)) {
    violations.push({
      severity: "high", category: "结构缺失", location: "大纲",
      description: "缺少主线(mainArc)——全书的核心剧情线未定义。",
      suggestion: "主线应回答'这个故事到底讲什么'，80-150字。",
    });
  }
  if (isEmpty(outline.mysteryBox)) {
    violations.push({
      severity: "high", category: "结构缺失", location: "大纲",
      description: "缺少核心悬念(mysteryBox)——无法持续牵引读者追读。",
      suggestion: "核心悬念应是最关键但暂时无法揭晓的未知，50-100字。",
    });
  }
  if (isEmpty(outline.endingDirection)) {
    violations.push({
      severity: "medium", category: "结构缺失", location: "大纲",
      description: "缺少结局方向(endingDirection)——结局气质与情感落点未定义。",
      suggestion: "结局方向描述'这本书最终给人什么感觉'，50-100字。",
    });
  }
  if (outline.volumes.length === 0) {
    violations.push({
      severity: "high", category: "结构缺失", location: "大纲",
      description: "无卷结构——大纲缺少分卷规划。",
      suggestion: "至少规划2-4卷，每卷5-8章。",
    });
  }

  // Check for empty volumes
  for (const vol of outline.volumes) {
    if (vol.chapters.length === 0) {
      violations.push({
        severity: "high", category: "结构缺失",
        location: `第${vol.sortOrder}卷《${vol.title}》`,
        description: "该卷没有章节。",
        suggestion: "每卷至少包含3章。",
      });
    }
  }

  return violations;
}

// ─── Utility ───────────────────────────────────────────

/** 1.2: Value-based comparison — chapter.order uniquely identifies within a volume */
function findVolumeForChapter(outline: StoryOutline, chapter: ChapterOutline): VolumeOutline | null {
  return outline.volumes.find(v => v.chapters.some(c => c.order === chapter.order)) ?? null;
}

// ─── Main entry ────────────────────────────────────────

export function validateOutline(outline: StoryOutline): ValidationReport {
  const allViolations: ConstraintViolation[] = [
    ...checkStructuralCompleteness(outline),
    ...checkConflictContinuity(outline),
    ...checkPacingRhythm(outline),
    ...checkVolumeConnectivity(outline),
    ...checkHookCoherence(outline),
  ];

  const highCount = allViolations.filter(v => v.severity === "high").length;
  const mediumCount = allViolations.filter(v => v.severity === "medium").length;
  const lowCount = allViolations.filter(v => v.severity === "low").length;

  const passed = highCount === 0;
  const warnings = allViolations
    .filter(v => v.severity === "low")
    .map(v => `[${v.category}] ${v.location}: ${v.description}`);

  let summary: string;
  if (allViolations.length === 0) {
    summary = "大纲结构完整，未检测到约束违规。";
  } else if (passed) {
    summary = `大纲通过（${mediumCount}项中等问题、${lowCount}项建议优化），无阻塞性问题。`;
  } else {
    summary = `大纲存在${highCount}项严重问题需修复，另有${mediumCount}项中等问题和${lowCount}项建议。`;
  }

  return { passed, violations: allViolations, warnings, summary };
}

/**
 * Validate an outline after generation.
 * Returns the report and, if there are high-severity issues, suggests re-generation.
 */
export function validateAndSummarize(outline: StoryOutline): {
  report: ValidationReport;
  needsRegeneration: boolean;
} {
  const report = validateOutline(outline);
  return {
    report,
    needsRegeneration: report.violations.filter(v => v.severity === "high").length > 1,
  };
}
