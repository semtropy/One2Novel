import { z } from "zod";

// ─── Novel ────────────────────────────────────────────

export const NovelCreateSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  description: z.string().max(50000).optional(),
  genre: z.string().max(100).optional(),
  writingScale: z.literal("long").default("long"),
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
  commercialTags: z.array(z.string()).optional(),
  narrativePov: z.enum(["first_person", "third_person", "mixed"]).optional(),
  pacePreference: z.enum(["slow", "balanced", "fast"]).optional(),
  styleTone: z.string().max(200).optional(),
  emotionIntensity: z.enum(["low", "medium", "high"]).optional(),
  defaultChapterLength: z.number().int().min(500).max(50000).optional(),
  estimatedChapterCount: z.number().int().min(1).max(1000).optional(),
  structuredOutline: z.string().optional(),
  titleSuggestions: z.string().optional(),
  // Unified story core
  storySummary: z.string().max(5000).optional(),
  centralQuestion: z.string().max(2000).optional(),
  endingDirection: z.string().max(2000).optional(),
  writingMode: z.enum(["original", "continuation"]).optional(),
  // Phase 0: Long-form web novel fields
  writingScale: z.literal("long").optional(),
  architectureType: z.enum(["skill_slot", "sequence_promotion", "case_driven", "cultivation_planning", "historical_transmigration", "hexagon_godhood", "custom"]).optional(),
  loopSkeleton: z.string().optional(),                       // JSON: LoopSkeleton
  goldenFinger: z.string().optional(),                        // JSON: {abilities:string[], limits:string[]}
  expectationProfile: z.string().optional(),                  // JSON
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
  scenePlan: z.string().optional(),
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

// ─── Snapshots ────────────────────────────────────────

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

// ─── Derived union types (extracted from schemas for reuse) ──

export type ChapterStatus = z.infer<typeof ChapterUpdateSchema>["chapterStatus"] extends infer U ? U : never;
// Resolved manually to avoid circular inference:
export type ChapterStatusLabel = "unplanned" | "planned" | "drafting" | "drafted" | "reviewing" | "needs_repair" | "completed";
export type NarrativePov = "first_person" | "third_person" | "mixed";
export type PacePreference = "slow" | "balanced" | "fast";
export type EmotionIntensity = "low" | "medium" | "high";
export type ProjectProgressStatus = "not_started" | "in_progress" | "completed" | "blocked";

// ─── Read DTOs ─────────────────────────────────────────

export interface ChapterDetail {
  id: string;
  title: string;
  order: number;
  content?: string | null;
  chapterStatus: ChapterStatusLabel;
  targetWordCount: number;
  actualWordCount?: number | null;
  expectation?: string | null;
  hook?: string | null;
  qualityScore?: number | null;
  openingScore?: number | null;
  plotScore?: number | null;
  characterScore?: number | null;
  dialogueScore?: number | null;
  suspenseScore?: number | null;
  pacingScore?: number | null;
  showNotTellScore?: number | null;
  languageScore?: number | null;
  genreScore?: number | null;
  coherenceScore?: number | null;
  repairHistory?: string | null;
  diagnosis?: string | null;
  riskFlags?: string | null;
  activeWorldRules?: string | null;
  scenePlan?: string | null;
  openConflicts?: string | null;
  finalizationSnapshot?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VolumeDetail {
  id: string;
  sortOrder: number;
  title: string;
  summary?: string | null;
  chapterPlans: Array<{
    id: string;
    chapterId: string | null;
    chapterOrder: number;
    title: string;
    summary?: string | null;
    purpose?: string | null;
    loopPhase?: LoopPhase | null;
    loopIndex?: number | null;
    coolPointType?: CoolPointType | null;
    hookType?: HookType | null;
    chapterType?: ChapterType | null;
    chapter?: { id: string; title: string; content?: string | null; chapterStatus: ChapterStatusLabel } | null;
  }>;
}

export interface NovelDetail {
  id: string;
  title: string;
  description?: string | null;
  genre?: string | null;
  status: string;
  narrativePov?: NarrativePov | null;
  pacePreference?: PacePreference | null;
  styleTone?: string | null;
  emotionIntensity?: EmotionIntensity | null;
  defaultChapterLength?: number | null;
  estimatedChapterCount?: number | null;
  structuredOutline?: string | null;
  targetAudience?: string | null;
  bookSellingPoint?: string | null;
  competingFeel?: string | null;
  first30ChapterPromise?: string | null;
  commercialTags?: string[] | null;
  titleSuggestions?: string | null;
  projectStatus?: ProjectProgressStatus;
  updatedAt: string;
  createdAt: string;
  // Unified story core
  storySummary?: string | null;
  centralQuestion?: string | null;
  endingDirection?: string | null;
  // Phase 0: Long-form fields
  writingMode?: string | null;
  writingScale?: WritingScale;
  architectureType?: ArchitectureType | null;
  activeProfileId?: string | null;
  loopSkeleton?: string | null;
  goldenFinger?: string | null;
  expectationProfile?: string | null;
  // Relations
  chapters: ChapterDetail[];
  characters: Array<{
    id: string; name: string; role: string; personality?: string | null;
    background?: string | null; appearance?: string | null; quirks?: string | null;
    currentStatus?: string | null; currentGoal?: string | null; voiceTexture?: string | null;
    identityLabel?: string | null; factionLabel?: string | null;
    prohibitions?: string | null; loopFunctionTag?: string | null;
    currentState?: string | null;
    currentLocation?: string | null; availability?: string | null;
  }>;
  volumes: VolumeDetail[];
  timelineItems: Array<{ title: string; category: string; sortOrder: number; status?: string }>;
  worldRules?: Array<{ id: string; category: string; title: string; content: string; priority: number; status: string }>;
  referenceBook?: { id: string; fileName: string; totalChapters: number | null; content?: string | null; annotations?: string | null; analysisSummary?: string | null; writingAssets?: string | null } | null;
  volumePresences?: Array<{ characterId: string; volumeOrder: number; presence: string }>;
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

// ─── Phase 0: Long-form web novel types ────────────────

/** Default chapter count for long-form web novels: ~1,500,000 chars ÷ 3,000 chars/chapter ≈ 500章 */
export const LONG_FORM_DEFAULT_CHAPTERS = 500;

export type WritingScale = "long";
export type ArchitectureType = "skill_slot" | "sequence_promotion" | "case_driven" | "cultivation_planning" | "historical_transmigration" | "hexagon_godhood" | "custom";
export type LoopPhase = "trigger" | "enter" | "explore" | "setback" | "turn" | "climax" | "settlement";
export type CoolPointType = "collect" | "strategy" | "verify" | "face_slap" | "reveal" | "upgrade";
export type HookType = "short_term" | "medium_term";
export type ChapterType = "advance" | "transition" | "cooldown" | "climax";

export interface LoopNode {
  phase: LoopPhase;
  label: string;
  description: string;
  typicalChapterCount: [number, number];
}

export interface LoopDefinition {
  phases: LoopNode[];
  estimatedChaptersPerLoop: [number, number];
  settlementTypes: string[];
  scaleUpDirections: string[];
}

export interface CoolPointRecipe {
  collect: number;
  strategy: number;
  verify: number;
  reveal: number;
  upgrade: number;
}

export interface HookProfile {
  shortTermPerChapter: number;
  mediumTermPerVolume: number;
  longTermLines: number;
}

export interface ExpectationProfile {
  coolPointRecipe: CoolPointRecipe;
  hookProfile: HookProfile;
  payoffWindow: number;  // 伏笔回收窗口（章数）
}

export interface ArchitectureTemplate {
  id: ArchitectureType;
  name: string;
  description: string;
  compatibleGenres: string[];
  defaultLoop: LoopDefinition;
  coolPointRecipe: CoolPointRecipe;
  hookProfile: HookProfile;
  representativeWorks: string[];
}

export interface LoopSkeletonItem {
  loopIndex: number;
  triggerEvent: string;
  dungeonName: string;
  estimatedChapters: number;
  settlementContent: string;
  scaleUpDirection: string;
}

export interface ReferenceBookAnnotation {
  loopBoundaries?: Array<{ chapterIndex: number; type: "start" | "end"; loopIndex?: number }>;
  highCoolChapters?: number[];
  lowCoolChapters?: number[];
  keySettings?: Array<{ chapterIndex: number; settingName: string; description: string }>;
}

// ─── Content Beat — 内容节拍类型 ────────────────────

/** Per-beat configuration: target percentage of chapters + typical chapter span */
export interface ContentBeatDef {
  pct: number;          // Target % of chapters in a loop
  span: string;         // Typical chapter span, e.g. "1-2章"
  label: string;        // Display label in Chinese
}

/** Full content beat recipe for a novel or architecture template */
export type ContentBeatProfile = Record<string, ContentBeatDef>;

/** Per-loop content beat distribution extracted from reference book */
export interface LoopContentBeatPattern {
  loopIndex: number;
  startChapter: number;
  endChapter: number;
  beats: Record<string, number>;  // beat type → chapter count in this loop
}

/** Reference book content beat analysis result */
export interface ContentBeatAnnotation {
  extractedAt: string;
  beatTypes: string[];                          // All detected beat types
  overallDistribution: Record<string, number>;   // beat type → total chapters
  loopPatterns: LoopContentBeatPattern[];        // Per-loop breakdown
  totalChapters: number;
}

export interface ReferenceProfileDetail {
  id: string;
  name: string;
  architectureType?: string | null;
  totalChapters?: number | null;
  loopBoundaries?: string | null;
  coolPointDensity?: string | null;
  hookPatterns?: string | null;
  goldenFingerBounds?: string | null;
  contentBeatPatterns?: string | null;
  writingAssets?: string | null;
  settingTimeline?: string | null;
  createdAt: string;
}

export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  estimatedRemainingCost: number | null;
  averageCostPerChapter: number;
  chapterCount: number;
}
