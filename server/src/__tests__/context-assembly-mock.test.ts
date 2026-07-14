/**
 * Mock test for context assembly — verifies that assembleChapterBlocks
 * returns a prioritized, deduplicated set of context blocks.
 *
 * Run: npx vitest run client/src/__tests__/context-assembly-mock.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock data ──────────────────────────────────────────────────

const mockNovel = {
  id: "novel-1",
  title: "Test Novel",
  genre: "仙侠",
  storySummary: "A hero rises",
  centralQuestion: "Can he survive?",
  endingDirection: "He wins",
  targetAudience: "Young adults",
  bookSellingPoint: "Unique power system",
  competingFeel: "Not like other xianxia",
  first30ChapterPromise: "Fast paced",
  chapters: [
    { id: "ch-1", order: 1, title: "Chapter 1", content: null, expectation: "Introduction", hook: null, scenePlan: null },
    { id: "ch-2", order: 2, title: "Chapter 2", content: "Some text here...", expectation: "First conflict", hook: "Who is the stranger?" },
  ],
  characters: [],
  volumes: [],
  commercialTags: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  narrativePov: "third_person",
  pacePreference: "fast",
  tonePitch: "energetic",
  defaultChapterLength: 3000,
  estimatedChapterCount: 500,
  writingScale: "long" as const,
};

const mockChapter = mockNovel.chapters[1];

const mockPrisma = {
  novel: {
    findUnique: vi.fn().mockResolvedValue(mockNovel),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  chapter: { findFirst: vi.fn().mockResolvedValue(null) },
  volumeChapterPlan: { findFirst: vi.fn().mockResolvedValue(null) },
  worldRule: { findMany: vi.fn().mockResolvedValue([]) },
  payoffLedgerItem: { findMany: vi.fn().mockResolvedValue([]) },
  timelineItem: { findMany: vi.fn().mockResolvedValue([]) },
  memoryItem: { findMany: vi.fn().mockResolvedValue([]) },
  entityStateJournal: { findMany: vi.fn().mockResolvedValue([]) },
  entityLifecycle: { findMany: vi.fn().mockResolvedValue([]) },
  referenceProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  styleProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  styleBinding: { findMany: vi.fn().mockResolvedValue([]) },
  chaseDebt: { findMany: vi.fn().mockResolvedValue([]) },
  overrideContract: { findMany: vi.fn().mockResolvedValue([]) },
  auditReport: { findMany: vi.fn().mockResolvedValue([]) },
};

// ── Mocks ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.novel.findUnique.mockResolvedValue(mockNovel);
  mockPrisma.volumeChapterPlan.findFirst.mockResolvedValue(null);
});

// Mock the repository
vi.mock("@one2novel/server/src/platform/db/client", () => ({
  getPrisma: () => mockPrisma,
  checkDbHealth: () => Promise.resolve({ status: "healthy" }),
}));

vi.mock("@one2novel/server/src/platform/data/repositories", () => ({
  createNovelRepo: () => ({
    findAssemblyBase: async (novelId: string) => {
      const novel = await mockPrisma.novel.findUnique({ where: { id: novelId } });
      if (!novel) throw new Error("Novel not found");
      return novel;
    },
    findAll: async () => [],
    findById: async () => null,
    findFullById: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
    getExpectationProfile: async () => null,
    getArchitectureProfile: async () => null,
  }),
}));

vi.mock("@one2novel/server/src/platform/llm/contextSelection", () => ({
  createContextBlock: vi.fn((opts: Record<string, unknown>) => ({
    id: String(opts.id),
    group: String(opts.group),
    priority: Number(opts.priority) || 50,
    content: String(opts.content ?? ""),
    conflictGroup: opts.conflictGroup as string | undefined,
    freshness: Number(opts.freshness) || 0,
    required: Boolean(opts.required),
    instructionHeader: opts.instructionHeader as string | undefined,
    estimatedTokens: 0,
  })),
}));

vi.mock("@one2novel/server/src/platform/logging/eventErrorLog", () => ({
  logEventError: vi.fn(),
}));

// Mock all the deep internal modules that assembleChapterBlocks calls
const mockBlock = {
  id: "test_block",
  group: "test",
  priority: 50,
  content: "test",
  estimatedTokens: 0,
};

vi.mock("@one2novel/server/src/modules/style/styleRuntimeResolver", () => ({
  resolveStyleContext: async () => ({ styleBlock: null, antiAiPrompt: null }),
}));

vi.mock("@one2novel/server/src/modules/novel/world/ruleActivationService", () => ({
  selectRelevantRules: async () => [],
  activateRulesForChapter: async () => undefined,
  getActiveRulesContext: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/openConflict", () => ({
  getActiveConflicts: async () => null,
}));

vi.mock("@one2novel/server/src/modules/timeline/timelineService", () => ({
  getTimelineContext: async () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/context/scenePlanService", () => ({
  compileScenePlanContext: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/planning/characterPrep/characterDynamicsService", () => ({
  generateChapterDynamics: async () => null,
  compileDynamicsContext: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/payoff/payoffService", () => ({
  getActivePayoffContext: async () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/characterFormatting", () => ({
  buildLiveFraming: () => null,
  buildLiveCharacters: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/context/tieredCompressionService", () => ({
  buildTieredContext: async () => ({ tier1Adjacent: null, tier2Recent: null, tier3VolumeSummary: null, tier4Archive: null }),
}));

vi.mock("@one2novel/server/src/modules/novel/production/quality/characterProhibitions", () => ({
  buildCharacterProhibitions: async () => [],
}));

vi.mock("@one2novel/server/src/modules/novel/production/context/ragContextBuilder", () => ({
  buildRagContextBlock: async () => null,
  buildRagBacktrackBlock: async () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/post/entityLifecycle", () => ({
  buildEntityLifecycleBlock: async () => [],
  compileEntityLifecycleContent: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/context/volumeCompressor", () => ({
  buildCurrentVolumeContext: async () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/post/memoryOrchestrator", () => ({
  buildMemoryPack: async () => null,
  compileMemoryPackContent: () => null,
}));

vi.mock("@one2novel/server/src/modules/novel/production/context/contentGuides", () => ({
  getLoopPhaseGuide: () => null,
  buildReferenceStyleHints: async () => null,
  buildReferenceCounterpart: async () => null,
  getContentBeatGuide: () => null,
}));

// ── Tests ──────────────────────────────────────────────────────

describe("Context assembly (mocked)", () => {
  it("assembleChapterBlocks returns blocks with required priorities", async () => {
    const { assembleChapterBlocks } = await import(
      "@one2novel/server/src/modules/novel/production/context/contextAssembler"
    );

    const blocks = await assembleChapterBlocks("novel-1", "ch-2");

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);

    // book_contract should always be present with high priority
    const contractBlock = blocks.find((b) => b.id === "book_contract");
    expect(contractBlock).toBeDefined();
    if (contractBlock) {
      expect(contractBlock.priority).toBeGreaterThanOrEqual(100);
      expect(contractBlock.content).toContain("故事简介");
    }

    // chapter_mission should be present
    const missionBlock = blocks.find((b) => b.id === "chapter_mission");
    expect(missionBlock).toBeDefined();
    if (missionBlock) {
      expect(missionBlock.priority).toBeGreaterThanOrEqual(100);
      expect(missionBlock.content).toContain("本章任务");
    }
  });

  it("includes previous chapter content when available", async () => {
    const { assembleChapterBlocks } = await import(
      "@one2novel/server/src/modules/novel/production/context/contextAssembler"
    );

    const blocks = await assembleChapterBlocks("novel-1", "ch-2");
    const prevHookBlock = blocks.find((b) => b.id === "previous_chapter_hook");

    expect(prevHookBlock).toBeDefined();
    if (prevHookBlock) {
      expect(prevHookBlock.content).toContain("Chapter 1");
    }
  });

  it("blocks are sorted by priority descending", async () => {
    const { assembleChapterBlocks } = await import(
      "@one2novel/server/src/modules/novel/production/context/contextAssembler"
    );

    const blocks = await assembleChapterBlocks("novel-1", "ch-2");

    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i - 1].priority).toBeGreaterThanOrEqual(blocks[i].priority);
    }
  });

  it("story_macro block is always present", async () => {
    const { assembleChapterBlocks } = await import(
      "@one2novel/server/src/modules/novel/production/context/contextAssembler"
    );

    const blocks = await assembleChapterBlocks("novel-1", "ch-2");
    const macroBlock = blocks.find((b) => b.id === "story_macro");

    expect(macroBlock).toBeDefined();
    if (macroBlock) {
      expect(macroBlock.priority).toBeGreaterThanOrEqual(98);
    }
  });

  it("rejects invalid novel ID", async () => {
    mockPrisma.novel.findUnique.mockResolvedValue(null);

    const { assembleChapterBlocks } = await import(
      "@one2novel/server/src/modules/novel/production/context/contextAssembler"
    );

    await expect(assembleChapterBlocks("nonexistent", "ch-1")).rejects.toThrow();
  });
});
