/**
 * Unified ArchitectureProfile — the canonical data contract for novel structure.
 *
 * Three sources → one format:
 *   1. Built-in templates (architectureRegistry.ts): hand-crafted defaults
 *   2. Reference book analysis: AI + statistical inference from uploaded text
 *   3. User-custom: manual editing
 *
 * All three are interchangeable. A user can start with a built-in template,
 * later replace it with a reference book profile, and tweak manually.
 *
 * Stored as JSON string on Novel.architectureProfile and ReferenceProfile.architectureProfile.
 */

// ── Loop Phase ─────────────────────────────────────────

export interface LoopPhase {
  /** Internal key (e.g. "trigger", "enter", "explore", "setback", "turn", "climax", "settlement") */
  phase: string;
  /** Display label in Chinese */
  label: string;
  /** What happens in this phase */
  description: string;
  /** Typical chapter count range */
  typicalChapterRange: [number, number];
}

// ── Chapter Type Distribution ──────────────────────────

export interface ChapterTypeDistribution {
  advance: number;    // 推进章 — substantive plot advancement
  transition: number; // 过渡章 — daily/training/travel
  cooldown: number;   // 冷却章 — emotional buffer after climax
  climax: number;     // 高潮章 — battle/reveal/ritual
  // All values are percentages (0-100). Must sum to 100.
}

// ── Chapter Length ─────────────────────────────────────

export interface ChapterLengthStats {
  min: number;
  max: number;
  avg: number;
}

// ── Cool Point Recipe ──────────────────────────────────

export interface CoolPointRecipe {
  collect: number;   // 获得能力/物品
  strategy: number;  // 策略推演/信息博弈
  verify: number;    // 验证战力/底牌揭露
  reveal: number;    // 揭示真相/世界观扩展
  upgrade: number;   // 升级突破/地位跃迁
  faceSlap: number;  // 打脸碾压/身份揭露
  // All values are percentages (0-100). Must sum to 100.
}

// ── Hook Profile ───────────────────────────────────────

export interface HookProfile {
  /** Short-term hooks per chapter (chapter-end cliffhanger) */
  shortTermPerChapter: number;
  /** Medium-term hooks per volume (volume-spanning mystery) */
  mediumTermPerVolume: number;
  /** Long-term hook lines spanning the entire book */
  longTermLines: number;
  /** Distribution of hook types */
  hookDistribution: {
    suspense: number;  // 悬念型 — leaves question or unknown info
    reversal: number;  // 反转型 — unexpected event or reveal
    preview: number;   // 预告型 — hints at what's coming next
    emotional: number; // 情绪型 — ends on emotional resonance
    // All values are percentages (0-100). Must sum to 100.
  };
}

// ── Content Beat DNA ───────────────────────────────────

export interface ContentBeatProfile {
  /** Each key is a beat type label, value is percentage (0-100) */
  [beatType: string]: number;
  // Common beat types: 修炼, 显圣, 赚钱, 恋爱, 日常, 过渡, 说明, 调查, 推理, 战斗
}

// ── Character System ───────────────────────────────────

export interface CharacterSystem {
  /** Total number of named characters with significant roles */
  avgTotal: number;
  /** Distribution by role */
  roleDistribution: {
    protagonist: number;
    antagonist: number;
    supporting: number;
    minor: number;
    // Percentages of total character count (not 100% — these are avg counts per role)
  };
  /** Avg chapters between appearances for non-protagonist characters */
  avgChaptersBetweenAppearances: number;
  /** How many characters appear in a typical chapter */
  avgCharactersPerChapter: number;
}

// ── Payoff Patterns ────────────────────────────────────

export interface PayoffPatterns {
  /** Average chapters from seed (first mention) to payoff (full reveal) */
  avgSeedToPayoffChapters: number;
  /** Average seeds planted per volume */
  seedsPerVolume: number;
  /** Typical payoff window — most payoffs resolve within N chapters */
  typicalPayoffWindow: number;
}

// ── Writing Technique ──────────────────────────────────

export interface WritingTechnique {
  category: string;
  observation: string;   // What the reference book does (50-150 chars)
  rule: string;          // Actionable imitation rule (50-150 chars)
  confidence: number;    // 0-1
}

export interface WritingTechniques {
  overallStyleDescription: string;
  narrativeAssets: WritingTechnique[];   // 叙事技法
  languageAssets: WritingTechnique[];    // 语言风格
  characterAssets: WritingTechnique[];   // 角色塑造
  rhythmAssets: WritingTechnique[];      // 节奏控制
  antiAiAssets: WritingTechnique[];      // 反AI特征
}

// ── Unified Profile ────────────────────────────────────

export interface ArchitectureProfile {
  /** Human-readable name (template name, reference book title, or user-given name) */
  name: string;
  /** Source: "builtin" | "reference" | "custom" */
  source: "builtin" | "reference" | "custom";
  /** When populated from reference analysis: the reference profile ID */
  sourceReferenceProfileId?: string;

  // ── Loop Structure ──
  loopPhases: LoopPhase[];

  // ── Rhythm Blueprint ──
  chapterTypeDistribution: ChapterTypeDistribution;
  avgChaptersPerLoop: ChapterLengthStats;
  avgChapterWordCount: ChapterLengthStats;

  // ── Cool Point Recipe ──
  coolPointRecipe: CoolPointRecipe;

  // ── Hook Strategy ──
  hookProfile: HookProfile;

  // ── Content Beat DNA ──
  contentBeatProfile: ContentBeatProfile;

  // ── Character System ──
  characterSystem: CharacterSystem;

  // ── Payoff Patterns ──
  payoffPatterns: PayoffPatterns;

  // ── Writing Techniques ──
  writingTechniques?: WritingTechniques;
}
