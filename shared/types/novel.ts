import { z } from "zod";

// ─── Novel ────────────────────────────────────────────

export const NovelCreateSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  description: z.string().max(50000).optional(),
  genre: z.string().max(100).optional(),
  writingMode: z.enum(["original", "continuation"]).default("original"),
  narrativePov: z.enum(["first_person", "third_person", "mixed"]).optional(),
  pacePreference: z.enum(["slow", "balanced", "fast"]).optional(),
  styleTone: z.string().max(200).optional(),
  defaultChapterLength: z.number().int().min(500).max(50000).optional(),
  estimatedChapterCount: z.number().int().min(1).max(1000).optional(),
});

export type NovelCreate = z.infer<typeof NovelCreateSchema>;

export const NovelUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(50000).optional(),
  genre: z.string().max(100).optional(),
  targetAudience: z.string().max(500).optional(),
  bookSellingPoint: z.string().max(1000).optional(),
  competingFeel: z.string().max(500).optional(),
  first30ChapterPromise: z.string().max(1000).optional(),
  commercialTags: z.string().optional(),
  narrativePov: z.enum(["first_person", "third_person", "mixed"]).optional(),
  pacePreference: z.enum(["slow", "balanced", "fast"]).optional(),
  styleTone: z.string().max(200).optional(),
  emotionIntensity: z.enum(["low", "medium", "high"]).optional(),
  defaultChapterLength: z.number().int().min(500).max(50000).optional(),
  estimatedChapterCount: z.number().int().min(1).max(1000).optional(),
  structuredOutline: z.string().optional(),
  draftSeed: z.string().optional(),
  titleSuggestions: z.string().optional(),
});

export type NovelUpdate = z.infer<typeof NovelUpdateSchema>;

// ─── Chapter ──────────────────────────────────────────

export const ChapterCreateSchema = z.object({
  title: z.string().min(1).max(200),
  order: z.number().int().min(0),
  targetWordCount: z.number().int().min(500).max(50000).default(3000),
  expectation: z.string().optional(),
});

export type ChapterCreate = z.infer<typeof ChapterCreateSchema>;

export const ChapterUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  chapterStatus: z
    .enum(["unplanned", "planned", "drafting", "drafted", "reviewing", "needs_repair", "completed"])
    .optional(),
  targetWordCount: z.number().int().min(500).max(50000).optional(),
  hook: z.string().optional(),
  expectation: z.string().optional(),
  sceneCards: z.string().optional(),
});

export type ChapterUpdate = z.infer<typeof ChapterUpdateSchema>;

// ─── Character ────────────────────────────────────────

export const NovelCharacterCreateSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(["protagonist", "antagonist", "supporting", "minor"]),
  personality: z.string().max(50000).optional(),
  background: z.string().max(5000).optional(),
});

export type NovelCharacterCreate = z.infer<typeof NovelCharacterCreateSchema>;

// ─── Lock / Contract ──────────────────────────────────

export const LOCK_SCOPES = ["story_seed", "characters", "blueprint"] as const;
export type LockScope = (typeof LOCK_SCOPES)[number];

export interface StorySeedSnapshot {
  premise: string;
  mainArc: string;
  mysteryBox: string;
  endingDirection: string;
  genre: string | null;
  narrativePov: string | null;
  pacePreference: string | null;
  styleTone: string | null;
  emotionIntensity: string | null;
  targetAudience: string | null;
  bookSellingPoint: string | null;
  competingFeel: string | null;
  first30ChapterPromise: string | null;
  commercialTags: string[];
  frozenAt: string;
}

export interface CharacterSnapshot {
  characters: Array<{
    name: string; role: string;
    personality: string | null; background: string | null;
    appearance: string | null; quirks: string | null; currentStatus: string | null;
    currentGoal: string | null; voiceTexture: string | null;
    identityLabel: string | null; factionLabel: string | null;
    prohibitions: string | null;
  }>;
  relations: Array<{
    sourceName: string; targetName: string;
    type: string; summary: string | null;
  }>;
  frozenAt: string;
}

export interface BlueprintSnapshot {
  volumes: Array<{
    sortOrder: number; title: string; summary: string;
    chapters: Array<{
      order: number; title: string; summary: string;
      coreEvent: string; hook: string; characters: string[];
      conflictLevel: number; revealLevel: number;
    }>;
  }>;
  beatSheets?: Record<number, {
    beats: Array<{ chapter: number; beatType: string; goal: string; conflict: string; reveal: string; emotionBeat: string }>;
    structureDiagnosis: string;
  }>;
  frozenAt: string;
}

export interface ConfirmationStatus {
  story_seed:  { confirmed: boolean; dirty: boolean; dirtyCount: number; lastConfirmedAt: string | null };
  characters:  { confirmed: boolean; dirty: boolean; dirtyCount: number; lastConfirmedAt: string | null };
  blueprint:   { confirmed: boolean; dirty: boolean; dirtyCount: number; lastConfirmedAt: string | null };
}

/** @deprecated — use ConfirmationStatus instead */
export interface LockStatus {
  locked: LockScope[];
  unlocked: LockScope[];
}

// ─── API Response ─────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
