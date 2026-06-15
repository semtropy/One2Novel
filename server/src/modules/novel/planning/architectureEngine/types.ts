/**
 * Architecture Engine types — shared definitions for loop-based long-form novel generation.
 */

export type ArchitectureType = "skill_slot" | "sequence_promotion" | "case_driven" | "cultivation_planning" | "historical_transmigration" | "hexagon_godhood" | "custom";
export type LoopPhase = "trigger" | "enter" | "explore" | "setback" | "turn" | "climax" | "settlement";
export type CoolPointType = "collect" | "strategy" | "verify" | "reveal" | "upgrade" | "face_slap";
export type ChapterType = "advance" | "transition" | "cooldown" | "climax";

export interface LoopPhaseDef {
  phase: LoopPhase;
  label: string;               // 中文标签，如「触发事件」
  description: string;         // 该阶段做什么
  typicalChapterCount: [number, number]; // [min, max]
}

export interface LoopDefinition {
  phases: LoopPhaseDef[];
  estimatedChaptersPerLoop: [number, number];
  settlementTypes: string[];    // 结算类型
  scaleUpDirections: string[];  // 升级方向
}

export interface CoolPointRecipe {
  collect: number;     // 收集快感占比 (0-100)
  strategy: number;    // 策略推演占比
  verify: number;      // 验证时刻占比
  reveal: number;      // 信息揭示占比
  upgrade: number;     // 升级快感占比
}

export interface HookProfile {
  shortTermPerChapter: number;   // 每章短期钩子数
  mediumTermPerVolume: number;   // 每卷中期钩子数
  longTermLines: number;         // 全书长期钩子线数
}

export interface ExpectationProfile {
  coolPointRecipe: CoolPointRecipe;
  hookProfile: HookProfile;
  payoffWindow: number;          // 伏笔回收窗口（章数）
}

export interface ArchitectureTemplate {
  id: ArchitectureType;
  name: string;
  description: string;
  compatibleGenres: string[];
  defaultLoop: LoopDefinition;
  defaultCoolPointRecipe: CoolPointRecipe;
  defaultHookProfile: HookProfile;
  representativeWorks: string[];
}

/** A single loop iteration in the novel skeleton */
export interface LoopSkeletonItem {
  loopIndex: number;
  triggerEvent: string;       // 触发事件概要
  dungeonName: string;        // 副本/事件名称
  estimatedChapters: number;  // 预计章节数
  settlementContent: string;  // 结算内容
  scaleUpDirection: string;   // 舞台升级方向
}

/** Full loop skeleton for a novel */
export interface LoopSkeleton {
  architectureType: ArchitectureType;
  totalLoops: number;
  loops: LoopSkeletonItem[];
  estimatedTotalChapters: number;
}

/** A chapter within an expanded volume */
export interface ExpandedChapter {
  chapterOrder: number;
  title: string;
  summary: string;
  loopPhase: LoopPhase;
  coolPointType?: CoolPointType;
  hookType?: "short_term" | "medium_term";
  chapterType: ChapterType;
  expectation: string;         // 本章目标
  coreEvent: string;           // 核心事件
  endingHook: string;          // 章尾钩子
}

/** An expanded volume with phase decomposition */
export interface ExpandedVolume {
  sortOrder: number;
  title: string;
  summary: string;
  loopIndex: number;
  phases: Array<{
    phase: LoopPhase;
    label: string;
    chapters: ExpandedChapter[];
  }>;
  totalChapters: number;
}
