/**
 * Centralized constants for the entire server.
 *
 * All magic numbers, timeouts, thresholds, and configuration values
 * live here so they can be found, reviewed, and tuned in one place.
 *
 * Usage: import { CHAPTER_TIMEOUT_MS } from "@one2novel/platform/config/constants";
 */

// ─── Director / Auto-Write ──────────────────────────────────

/** Maximum time (ms) to wait for a single chapter LLM response */
export const CHAPTER_TIMEOUT_MS = 120_000;

/** Maximum number of chapters the director writes in a single batch */
export const DIRECTOR_BATCH_LIMIT = 30;

/** Maximum number of event listeners on the director EventEmitter */
export const DIRECTOR_MAX_LISTENERS = 50;

/** Idle time (ms) before removing a director progress object from memory */
export const DIRECTOR_PROGRESS_IDLE_TTL = 300_000;

/** Maximum connection age before forced Prisma reconnect (ms) — 1 hour */
export const MAX_CONNECTION_AGE_MS = 3_600_000;

// ─── Novel / Shared ─────────────────────────────────────────

/** Default chapter count for long-form web novels (~1.5M chars ÷ 3K chars/chapter) */
export const LONG_FORM_DEFAULT_CHAPTERS = 500;

// ─── Quality Gate ───────────────────────────────────────────

/** Minimum total quality score for standard genres to PASS */
export const QUALITY_PASS_THRESHOLD_STANDARD = 60;

/** Minimum total quality score for strict genres (悬疑/奇幻) to PASS */
export const QUALITY_PASS_THRESHOLD_STRICT = 65;

/** Score delta between total and threshold for WARNING verdict */
export const QUALITY_WARNING_DELTA = 10;

// ─── Context Selection (LLM) ────────────────────────────────

/** Blocks with priority >= this value are always kept during token budget enforcement */
export const CTX_PRIORITY_FORCE_KEEP = 90;

/** Blocks with priority in [SUMMARIZE, FORCE_KEEP) are truncated to fit budget */
export const CTX_PRIORITY_SUMMARIZE = 60;

/** Blocks with priority < DROP are discarded when budget is exceeded */
export const CTX_PRIORITY_DROP = 60;

// ─── Freshness Decay ────────────────────────────────────────

/** Default decay rate for freshness groups not explicitly configured */
export const DEFAULT_FRESHNESS_DECAY_RATE = 50;

// ─── RAG / Chunking ─────────────────────────────────────────

export const RAG_CHUNK_CONFIG = {
  /** Scene chunk size in characters */
  sceneChunkSize: 1500,
  /** Overlap between adjacent scene chunks */
  sceneOverlap: 300,
  /** Summary chunk size in characters */
  summaryChunkSize: 2000,
  /** Maximum number of scenes extracted per chapter */
  maxScenesPerChapter: 20,
} as const;

// ─── Debt System ────────────────────────────────────────────

/** Default interest rate per chapter for chase debts */
export const DEBT_INTEREST_RATE = 0.1;

// ─── Error Handling ─────────────────────────────────────────

/** Maximum length of error message sent to client before truncation */
export const ERROR_MSG_TRUNCATE_AT = 150;

// ─── Post-Write Handlers ────────────────────────────────────

/** Maximum concurrent post-write handlers (backpressure limit) */
export const POST_WRITE_MAX_CONCURRENT = 3;

/** Default max items for timeline context retrieval */
export const TIMELINE_MAX_ITEMS = 30;

/** Default max items for conflict context retrieval */
export const CONFLICT_MAX_ITEMS = 15;

/** Default max items for character dynamics retrieval */
export const CHARACTER_DYNAMICS_MAX_ITEMS = 50;

/** Payoff staleness threshold base (chapters) */
export const PAYOFF_STALENESS_BASE = 50;

/** Payoff staleness threshold max (chapters) */
export const PAYOFF_STALENESS_MAX = 100;

// ─── Rate Limiting ──────────────────────────────────────────

/** Sliding window duration for LLM rate limiter (ms) */
export const RATE_LIMIT_LLM_WINDOW_MS = 60_000;

/** Maximum LLM requests per novelId within the window */
export const RATE_LIMIT_LLM_MAX_REQUESTS = 20;

// ─── Structured Output Hint ─────────────────────────────────

/** Maximum recursion depth when building Zod schema examples */
export const DEFAULT_MAX_STRUCTURE_DEPTH = 6;

/** Default number of array items to include in schema examples */
export const DEFAULT_ARRAY_ITEM_COUNT = 1;

/** Maximum exact array example items from schema checks */
export const MAX_EXACT_ARRAY_EXAMPLE_ITEMS = 2;

// ─── Diff / Revision ────────────────────────────────────────

/** Maximum tokens for LCS diff computation (~3000 Chinese chars to prevent OOM) */
export const DIFF_MAX_TOKENS = 3000;

/** Character slice length for diff fallback */
export const DIFF_FALLBACK_SLICE = 500;

// ─── Chapter Writing ────────────────────────────────────────

/** Maximum excerpt length from previous chapter for context preview */
export const CHAPTER_EXCERPT_MAX = 200;

/** Maximum length of inline suggestion input */
export const INLINE_SUGGEST_MIN_CHARS = 50;

/** Maximum length of inline suggestion text for LLM */
export const INLINE_SUGGEST_MAX_CHARS = 2000;

// ─── Reference Analysis ─────────────────────────────────────

/** Maximum characters per batch in reference deep analysis */
export const REF_ANALYSIS_MAX_CHARS = 60_000;

/** Maximum characters for chapter snippet in reference analysis */
export const REF_CHUNK_SIZE = 15_000;

/** Prompt slice limit for various reference services */
export const REF_PROMPT_SLICE = 3_000;

/** Prompt slice limit for world framework and open conflict services */
export const REF_PROMPT_SLICE_LARGE = 6_000;

/** Maximum characters for reference book content slice */
export const REF_BOOK_CONTENT_SLICE = 5_000;

// ─── Scene Plan ─────────────────────────────────────────────

/** Maximum estimated words for a scene */
export const SCENE_MAX_ESTIMATED_WORDS = 3000;

/** Estimated words per scene when splitting a chapter */
export const SCHEME_ESTIMATED_WORDS_PER_SCENE = 3000;

// ─── Payoff ─────────────────────────────────────────────────

/** Maximum length of payoff chapter content for scanning */
export const PAYOFF_CHAPTER_CONTENT_SLICE = 6_000;

// ─── Timeline ───────────────────────────────────────────────

/** Maximum length of timeline context for LLM */
export const TIMELINE_CONTEXT_SLICE = 6_000;

// ─── Style ──────────────────────────────────────────────────

/** Maximum length of style binding content */
export const STYLE_BINDING_CONTENT_SLICE = 3_000;

// ─── Export ─────────────────────────────────────────────────

/** Maximum content length for export format cleanup */
export const EXPORT_CLEANUP_SLICE = 5_000;
