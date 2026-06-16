export { SEVERITY_LABEL } from "./types/labels.js";
export type { SeverityKey } from "./types/labels.js";

// All novel types & schemas
export {
  NovelCreateSchema,
  NovelUpdateSchema,
  ChapterCreateSchema,
  ChapterUpdateSchema,
  NovelCharacterCreateSchema,
} from "./types/novel.js";

export type {
  NovelCreate,
  NovelUpdate,
  ChapterCreate,
  ChapterUpdate,
  NovelCharacterCreate,
  // Snapshots
  StorySeedSnapshot,
  CharacterSnapshot,
  BlueprintSnapshot,
  // Read DTOs
  ChapterDetail,
  VolumeDetail,
  NovelDetail,
  // API
  ApiResponse,
  ApiError,
  PaginatedResponse,
  // Derived union types
  ChapterStatusLabel,
  NarrativePov,
  PacePreference,
  EmotionIntensity,
  ProjectProgressStatus,
  // Phase 0: Long-form types
  WritingScale,
  ArchitectureType,
  LoopPhase,
  CoolPointType,
  HookType,
  ChapterType,
  LoopNode,
  LoopDefinition,
  CoolPointRecipe,
  HookProfile,
  ExpectationProfile,
  ArchitectureTemplate,
  LoopSkeletonItem,
  ReferenceBookAnnotation,
  CostSummary,
  // Content Beat
  ContentBeatDef,
  ContentBeatProfile,
  LoopContentBeatPattern,
  ContentBeatAnnotation,
  ReferenceProfileDetail,
} from "./types/novel.js";
