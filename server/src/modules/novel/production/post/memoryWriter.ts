/**
 * MemoryWriter — write-after fact沉淀 into the semantic memory store.
 *
 * After each chapter is completed, this service extracts structured facts
 * from existing post-write hook results (character state updates, chapter
 * summaries, incremental summaries) and upserts them as MemoryItem records.
 *
 * Unlike webnovel-writer which needs a separate data-agent LLM call for
 * fact extraction, One2Novel reuses the results already produced by
 * characterStateUpdater and generateChapterSummary — zero extra LLM cost.
 *
 * Fire-and-forget: failures are logged but never block chapter writing.
 */
import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

// ─── Types ───────────────────────────────────────────────

export interface MemoryWriteInput {
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  content: string;
  characterUpdates?: Array<{
    characterId: string;
    characterName: string;
    oldStatus: string | null;
    newStatus: string | null;
    currentLocation: string | null;
    currentGoal: string | null;
  }>;
  keyEvents?: string[];
  characterChanges?: string[];
  worldReveals?: string[];
  unresolvedPayoffs?: string[];
}

interface UpsertResult {
  itemsAdded: number;
  itemsUpdated: number;
  itemsOutdated: number;
}

// ─── Category priority (for filtering) ───────────────────

const CATEGORY_PRIORITY: Record<string, number> = {
  world_rule: 0,
  open_loop: 1,
  character_state: 2,
  relationship: 3,
  reader_promise: 4,
  story_fact: 5,
  timeline: 6,
};

// ─── Public API ──────────────────────────────────────────

/**
 * Extract facts from post-write hook results and persist as MemoryItem records.
 *
 * This is the write-after half of the semantic memory system. It is called
 * from postWriteBus.handleMemoryWrite() after a chapter has been saved.
 *
 * If explicit input is provided (from already-executed hooks), it uses that.
 * Otherwise, it queries the DB directly for the latest data.
 */
export async function writeMemories(
  input: MemoryWriteInput & { useDbFallback?: boolean },
): Promise<UpsertResult> {
  const result: UpsertResult = { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 };
  const novelId = input.novelId;
  const chapterOrder = input.chapterOrder;
  let characterUpdates = input.characterUpdates;
  let keyEvents = input.keyEvents;
  let characterChanges = input.characterChanges;
  let worldReveals = input.worldReveals;
  let unresolvedPayoffs = input.unresolvedPayoffs;
  const useDbFallback = input.useDbFallback ?? true;

  // If no explicit input and DB fallback is enabled, query latest data
  if (!characterUpdates && useDbFallback) {
    characterUpdates = await fetchLatestCharacterStates(novelId, chapterOrder);
  }
  if (!keyEvents && useDbFallback) {
    keyEvents = await fetchLatestIncrementalKeyEvents(novelId, chapterOrder);
  }
  if (!unresolvedPayoffs && useDbFallback) {
    unresolvedPayoffs = await fetchPendingPayoffTitles(novelId);
  }

  const charUpdates = characterUpdates ?? [];
  const evts = keyEvents ?? [];
  const changes = characterChanges ?? [];
  const reveals = worldReveals ?? [];
  const payoffs = unresolvedPayoffs ?? [];

  // 1. Character state changes → character_state
  if (charUpdates) {
    for (const update of charUpdates) {
      if (update.newStatus && update.newStatus !== update.oldStatus) {
        await upsertMemoryItem(novelId, {
          category: "character_state",
          subject: update.characterName,
          field: "currentStatus",
          value: update.newStatus,
          sourceChapter: chapterOrder,
          payload: { oldStatus: update.oldStatus },
        }, result);
      }
      if (update.currentLocation) {
        await upsertMemoryItem(novelId, {
          category: "character_state",
          subject: update.characterName,
          field: "currentLocation",
          value: update.currentLocation,
          sourceChapter: chapterOrder,
        }, result);
      }
      if (update.currentGoal) {
        await upsertMemoryItem(novelId, {
          category: "character_state",
          subject: update.characterName,
          field: "currentGoal",
          value: update.currentGoal,
          sourceChapter: chapterOrder,
        }, result);
      }
    }
  }

  // 2. Key events from incremental summary → story_fact
  if (evts) {
    for (const event of evts) {
      if (event.trim()) {
        await upsertMemoryItem(novelId, {
          category: "story_fact",
          subject: event.trim().slice(0, 80),
          field: "event",
          value: event.trim(),
          sourceChapter: chapterOrder,
        }, result);
      }
    }
  }

  // 3. Character changes from incremental summary → story_fact
  if (changes) {
    for (const change of changes) {
      if (change.trim()) {
        await upsertMemoryItem(novelId, {
          category: "story_fact",
          subject: change.trim().slice(0, 80),
          field: "change",
          value: change.trim(),
          sourceChapter: chapterOrder,
        }, result);
      }
    }
  }

  // 4. World reveals → world_rule
  if (reveals) {
    for (const reveal of reveals) {
      if (reveal.trim()) {
        await upsertMemoryItem(novelId, {
          category: "world_rule",
          subject: reveal.trim().slice(0, 60),
          field: "rule_content",
          value: reveal.trim(),
          sourceChapter: chapterOrder,
        }, result);
      }
    }
  }

  // 5. Unresolved payoffs → open_loop
  if (payoffs) {
    for (const payoff of payoffs) {
      if (payoff.trim()) {
        await upsertMemoryItem(novelId, {
          category: "open_loop",
          subject: payoff.trim().slice(0, 80),
          field: "status",
          value: "pending",
          sourceChapter: chapterOrder,
          payload: { type: "payoff" },
        }, result);
      }
    }
  }

  return result;
}

/**
 * Upsert a single MemoryItem with deduplication.
 *
 * Same-key existing items are marked "outdated" (preserved for audit trail).
 * New items are inserted; existing items are updated in place.
 */
async function upsertMemoryItem(
  novelId: string,
  item: {
    category: string;
    subject: string;
    field: string;
    value: string;
    sourceChapter: number;
    payload?: Record<string, unknown>;
  },
  result: UpsertResult,
): Promise<void> {
  const prisma = getPrisma();
  const { category, subject, field, value, sourceChapter, payload } = item;

  // Skip empty values
  if (!value || !value.trim()) return;

  try {
    const existing = await prisma.memoryItem.findUnique({
      where: {
        novelId_category_subject_field: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
        },
      },
      select: { id: true, status: true },
    });

    if (existing && existing.status === "active") {
      // Mark old value as outdated
      await prisma.memoryItem.updateMany({
        where: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
          status: "active",
        },
        data: { status: "outdated" },
      });
      result.itemsOutdated++;
    }

    // Upsert the new value
    await prisma.memoryItem.upsert({
      where: {
        novelId_category_subject_field: {
          novelId,
          category,
          subject: subject.slice(0, 200),
          field: field.slice(0, 100),
        },
      },
      create: {
        novelId,
        category,
        subject: subject.slice(0, 200),
        field: field.slice(0, 100),
        value: value.slice(0, 2000),
        sourceChapter,
        payload: payload ? JSON.stringify(payload) : null,
      },
      update: {
        value: value.slice(0, 2000),
        sourceChapter,
        status: "active",
        payload: payload ? JSON.stringify(payload) : undefined,
      },
    });

    result.itemsUpdated += existing ? 1 : 0;
    result.itemsAdded += existing ? 0 : 1;
  } catch (e) {
    logEventError("memoryWriter.upsert", { novelId, category, subject, field, chapter: sourceChapter }, e);
  }
}

// ─── Bootstrap: migrate existing data to MemoryItem ──────

/**
 * Migrate data from existing tables into MemoryItem records.
 *
 * Called once (e.g. via a CLI command or on first write after migration).
 * Idempotent — safe to run multiple times.
 */
export async function bootstrapMemories(novelId: string): Promise<{
  migrated: number;
  sources: Record<string, number>;
}> {
  const prisma = getPrisma();
  const migrated = 0;
  const sources: Record<string, number> = {};

  try {
    // 1. WorldRule → world_rule
    const worldRules = await prisma.worldRule.findMany({
      where: { novelId, status: "active" },
      select: { title: true, content: true, category: true },
    });
    for (const rule of worldRules) {
      await upsertMemoryItem(novelId, {
        category: "world_rule",
        subject: rule.title.slice(0, 80),
        field: "rule_content",
        value: rule.content,
        sourceChapter: 0, // bootstrapped, no chapter
        payload: { source: "WorldRule", category: rule.category },
      }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
    }
    sources.worldRule = worldRules.length;

    // 2. Latest EntityStateJournal per character → character_state
    const characters = await prisma.novelCharacter.findMany({
      where: { novelId },
      select: {
        id: true,
        name: true,
        currentStatus: true,
        currentLocation: true,
        currentGoal: true,
      },
    });
    for (const char of characters) {
      if (char.currentStatus) {
        await upsertMemoryItem(novelId, {
          category: "character_state",
          subject: char.name.slice(0, 80),
          field: "currentStatus",
          value: char.currentStatus,
          sourceChapter: 0,
          payload: { source: "character_current" },
        }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
      }
      if (char.currentLocation) {
        await upsertMemoryItem(novelId, {
          category: "character_state",
          subject: char.name.slice(0, 80),
          field: "currentLocation",
          value: char.currentLocation,
          sourceChapter: 0,
          payload: { source: "character_current" },
        }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
      }
    }
    sources.character = characters.length;

    // 3. Pending payoffs → open_loop / reader_promise
    const payoffs = await prisma.payoffLedgerItem.findMany({
      where: {
        novelId,
        currentStatus: { in: ["setup", "hinted", "pending_payoff"] },
      },
      select: { title: true, summary: true, firstSeenOrder: true, scopeType: true },
    });
    for (const p of payoffs) {
      const category = p.scopeType === "book" ? "reader_promise" : "open_loop";
      await upsertMemoryItem(novelId, {
        category,
        subject: p.title.slice(0, 80),
        field: "status",
        value: p.summary ?? p.title,
        sourceChapter: p.firstSeenOrder ?? 0,
        payload: { source: "PayoffLedgerItem" },
      }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
    }
    sources.payoff = payoffs.length;

    // 4. IncrementalSummary keyEvents → story_fact
    const summaries = await prisma.incrementalSummary.findMany({
      where: { novelId },
      select: { startChapter: true, endChapter: true, keyEvents: true, characterChanges: true, worldReveals: true, unresolvedPayoffs: true },
    });
    for (const s of summaries) {
      const parseJson = (field: string) => {
        try { return JSON.parse(s[field as keyof typeof s] as string ?? "[]") as string[]; } catch { return []; }
      };
      for (const event of parseJson("keyEvents")) {
        if (event.trim()) {
          await upsertMemoryItem(novelId, {
            category: "story_fact",
            subject: event.trim().slice(0, 80),
            field: "event",
            value: event.trim(),
            sourceChapter: s.startChapter,
            payload: { source: "IncrementalSummary" },
          }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
        }
      }
    }
    sources.incrementalSummary = summaries.length;

    // 5. NovelCharacterRelation → relationship
    const relations = await prisma.novelCharacterRelation.findMany({
      where: { novelId },
      select: { sourceCharacter: { select: { name: true } }, targetCharacter: { select: { name: true } }, type: true, summary: true },
    });
    for (const r of relations) {
      if (r.sourceCharacter.name && r.targetCharacter.name) {
        await upsertMemoryItem(novelId, {
          category: "relationship",
          subject: r.sourceCharacter.name.slice(0, 80),
          field: r.targetCharacter.name.slice(0, 80),
          value: r.type,
          sourceChapter: 0,
          payload: { source: "NovelCharacterRelation", description: r.summary ?? "" },
        }, { itemsAdded: 0, itemsUpdated: 0, itemsOutdated: 0 });
      }
    }
    sources.relation = relations.length;

    return { migrated: Object.values(sources).reduce((a, b) => a + b, 0), sources };
  } catch (e) {
    logEventError("memoryWriter.bootstrap", { novelId }, e);
    return { migrated: 0, sources };
  }
}

// ─── DB fallback fetchers ──────────────────────────────────

/**
 * Fetch the latest character states from the most recent completed chapter.
 * Used when no explicit characterUpdates are provided.
 */
async function fetchLatestCharacterStates(
  novelId: string,
  currentChapter: number,
): Promise<Array<{
  characterId: string;
  characterName: string;
  oldStatus: string | null;
  newStatus: string | null;
  currentLocation: string | null;
  currentGoal: string | null;
}>> {
  const prisma = getPrisma();
  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: {
      id: true, name: true, currentStatus: true, currentLocation: true, currentGoal: true,
    },
  });
  if (characters.length === 0) return [];
  return characters.map((c: { id: string; name: string; currentStatus: string | null; currentLocation: string | null; currentGoal: string | null }) => ({
    characterId: c.id,
    characterName: c.name,
    oldStatus: c.currentStatus,
    newStatus: c.currentStatus,
    currentLocation: c.currentLocation,
    currentGoal: c.currentGoal,
  }));
}

/**
 * Fetch key events from the most recent IncrementalSummary.
 */
async function fetchLatestIncrementalKeyEvents(
  novelId: string,
  currentChapter: number,
): Promise<string[]> {
  const prisma = getPrisma();
  const summary = await prisma.incrementalSummary.findFirst({
    where: { novelId, endChapter: { lt: currentChapter } },
    orderBy: { endChapter: "desc" },
    select: { keyEvents: true },
  });
  if (!summary) return [];
  try { return JSON.parse(summary.keyEvents ?? "[]") as string[]; } catch { return []; }
}

/**
 * Fetch pending payoff titles for open_loop injection.
 */
async function fetchPendingPayoffTitles(novelId: string): Promise<string[]> {
  const prisma = getPrisma();
  const payoffs = await prisma.payoffLedgerItem.findMany({
    where: { novelId, currentStatus: { in: ["setup", "hinted", "pending_payoff"] } },
    select: { title: true },
    take: 10,
  });
  return payoffs.map(p => p.title);
}
