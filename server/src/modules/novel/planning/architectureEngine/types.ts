/**
 * Architecture Engine types — re-exports from shared.
 *
 * This module provides a convenient import path for architecture-engine
 * consumers. All type definitions live in @one2novel/shared/types/novel.ts
 * as the single source of truth.
 */

import type {
  ArchitectureType,
  LoopPhase,
  CoolPointType,
  ChapterType,
  LoopDefinition,
  CoolPointRecipe,
  HookProfile,
  ExpectationProfile,
  ContentBeatDef,
  ContentBeatProfile,
  ArchitectureTemplate,
  LoopSkeletonItem,
} from "@one2novel/shared";

export type {
  ArchitectureType,
  LoopPhase,
  CoolPointType,
  ChapterType,
  LoopDefinition,
  CoolPointRecipe,
  HookProfile,
  ExpectationProfile,
  ContentBeatDef,
  ContentBeatProfile,
  ArchitectureTemplate,
  LoopSkeletonItem,
};

// ─── Architecture Engine specific interfaces ─────────────

export interface LoopPhaseDef {
  phase: LoopPhase;
  label: string;               // 中文标签，如「触发事件」
  description: string;         // 该阶段做什么
  typicalChapterCount: [number, number]; // [min, max]
}

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
  contentBeat?: string;        // 内容节拍类型
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
