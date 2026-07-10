/**
 * Quality Dimensions — 10 维质量评分的唯一权威源。
 *
 * 所有消费端（qualityGate, statisticsService, ReviewPanel）从此常量派生
 * 维度列表，防止新增维度时遗漏。
 *
 * 新增维度只需修改此文件，其余自动同步。
 */

export interface QualityDimensionDef {
  /** Unique key for this dimension */
  readonly key: string;
  /** Display label in Chinese */
  readonly label: string;
  /** QualityResult field name, e.g. "openingScore" */
  readonly scoreField: keyof QualityScoreFields;
  /** Reviewer category for dimension_results */
  readonly category: string;
  /** Diagnostic group name (used in DIAGNOSTICS lookup) */
  readonly diagnosticGroup: string;
  /** Writing Skill principle reference */
  readonly principle: string;
}

interface QualityScoreFields {
  openingScore: number;
  plotScore: number;
  characterScore: number;
  dialogueScore: number;
  suspenseScore: number;
  pacingScore: number;
  showNotTellScore: number;
  languageScore: number;
  genreScore: number;
  coherenceScore: number;
}

/** All 10 quality dimensions in display order */
export const QUALITY_DIMENSIONS: readonly QualityDimensionDef[] = [
  {
    key: "opening",
    label: "开头吸引力",
    scoreField: "openingScore",
    category: "style",
    diagnosticGroup: "开头吸引力",
    principle: "开头六种致命错误 · 十种强力开头技巧",
  },
  {
    key: "plot",
    label: "情节推进",
    scoreField: "plotScore",
    category: "logic",
    diagnosticGroup: "情节推进",
    principle: "三大黄金法则 · 冲突驱动剧情",
  },
  {
    key: "character",
    label: "人物塑造",
    scoreField: "characterScore",
    category: "character",
    diagnosticGroup: "人物塑造",
    principle: "展示而非讲述 · 侧面揭示技法",
  },
  {
    key: "dialogue",
    label: "对话质量",
    scoreField: "dialogueScore",
    category: "character",
    diagnosticGroup: "对话质量",
    principle: "对话核心原则：每句必须有目的",
  },
  {
    key: "suspense",
    label: "悬念设置",
    scoreField: "suspenseScore",
    category: "logic",
    diagnosticGroup: "悬念设置",
    principle: "悬念钩子十三式 · 三大黄金法则",
  },
  {
    key: "pacing",
    label: "节奏控制",
    scoreField: "pacingScore",
    category: "pacing",
    diagnosticGroup: "节奏控制",
    principle: "长短句交替 · 段落呼吸",
  },
  {
    key: "showNotTell",
    label: "展示而非讲述",
    scoreField: "showNotTellScore",
    category: "style",
    diagnosticGroup: "展示而非讲述",
    principle: "三大黄金法则之首：展示而非讲述",
  },
  {
    key: "language",
    label: "语言质量",
    scoreField: "languageScore",
    category: "style",
    diagnosticGroup: "语言质量",
    principle: "AI 写作痕迹清除 · 用词精确",
  },
  {
    key: "genre",
    label: "题材适应度",
    scoreField: "genreScore",
    category: "setting",
    diagnosticGroup: "题材适配",
    principle: "题材适配原则",
  },
  {
    key: "coherence",
    label: "跨章连贯性",
    scoreField: "coherenceScore",
    category: "continuity",
    diagnosticGroup: "跨章连贯",
    principle: "连贯性保证",
  },
] as const;

/** All score field names as a readonly tuple */
export const SCORE_FIELD_NAMES: readonly (keyof QualityScoreFields)[] =
  QUALITY_DIMENSIONS.map(d => d.scoreField);

/** Derived: scoreField → category mapping */
export const DIMENSION_CATEGORY: Readonly<Record<string, string>> = Object.fromEntries(
  QUALITY_DIMENSIONS.map(d => [d.scoreField, d.category]),
) as Readonly<Record<string, string>>;

/** Derived: diagnosticGroup → category mapping */
export const DIAGNOSTIC_CATEGORY: Readonly<Record<string, string>> = Object.fromEntries(
  QUALITY_DIMENSIONS.map(d => [d.diagnosticGroup, d.category]),
) as Readonly<Record<string, string>>;
