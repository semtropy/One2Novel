/**
 * MemoryOrchestrator — write-before semantic memory injection.
 *
 * Builds a memory pack for a given chapter, filtering and budgeting
 * semantic memory items from the MemoryItem store. The pack is compiled
 * into a human-readable context block that gets injected into the LLM
 * prompt via assembleChapterBlocks().
 *
 * Architecture:
 *   1. Load all active MemoryItem records for the novel
 *   2. Filter by time window (sourceChapter >= currentChapter - MEMORY_WINDOW)
 *   3. Sort by category priority then recency
 *   4. Apply budget limits per category
 *   5. Compile into formatted context block text
 *
 * Budget strategy (aligned with wNW but tuned for our DB-based approach):
 *   - active_constraints (world_rule + open_loop): hard limit, always injected
 *   - semantic_memory: capped to control token usage
 *   - No episodic memory layer (we have EntityStateJournal + entity_lifecycle)
 */
import { getPrisma } from "../../../../platform/db/client";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

// ─── Constants ─────────────────────────────────────────────

const MEMORY_WINDOW = 50; // Look back N chapters for relevant memory
const SEMANTIC_MEMORY_LIMIT = 25; // Max semantic items to inject
const ACTIVE_CONSTRAINTS_LIMIT = 10; // Max world_rule + open_loop (hard constraints)

const CATEGORY_PRIORITY: Record<string, number> = {
  world_rule: 0,
  open_loop: 1,
  character_state: 2,
  relationship: 3,
  reader_promise: 4,
  story_fact: 5,
  timeline: 6,
};

const CATEGORY_LABELS: Record<string, string> = {
  world_rule: "世界规则（硬约束）",
  open_loop: "待回收伏笔",
  reader_promise: "读者承诺",
  character_state: "角色状态",
  relationship: "角色关系",
  story_fact: "关键事件",
  timeline: "时间线",
};

// ─── Types ─────────────────────────────────────────────────

interface MemoryPackStats {
  total: number;
  injected: number;
  filtered: number;
  byCategory: Record<string, number>;
}

export interface MemoryPack {
  injected: Array<{
    category: string;
    subject: string;
    field: string;
    value: string;
    sourceChapter: number;
    payload?: Record<string, unknown>;
  }>;
  activeConstraints: Array<{
    category: string;
    subject: string;
    value: string;
  }>;
  stats: MemoryPackStats;
}

// ─── Public API ────────────────────────────────────────────

/**
 * Build a memory pack for the given chapter.
 *
 * This is the write-before half of the semantic memory system. Called
 * from assembleChapterBlocks() to build the semantic_memory context block.
 */
export async function buildMemoryPack(
  novelId: string,
  chapterOrder: number,
): Promise<MemoryPack | null> {
  const prisma = getPrisma();
  const cutoff = chapterOrder - MEMORY_WINDOW;

  try {
    // Load all active memory items for this novel within the time window
    const items = await prisma.memoryItem.findMany({
      where: {
        novelId,
        status: "active",
        sourceChapter: { gte: cutoff },
      },
      orderBy: [
        { category: "asc" },
        { sourceChapter: "desc" },
      ],
    });

    if (items.length === 0) return null;

    // Sort by category priority, then by source chapter (most recent first)
    const sorted = items.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 99;
      const pb = CATEGORY_PRIORITY[b.category] ?? 99;
      if (pa !== pb) return pa - pb;
      return b.sourceChapter - a.sourceChapter;
    });

    // Separate active constraints (world_rule + open_loop) from semantic memory
    const activeConstraints: typeof items = [];
    const semanticItems: typeof items = [];

    for (const item of sorted) {
      if (item.category === "world_rule" || item.category === "open_loop") {
        activeConstraints.push(item);
      } else {
        semanticItems.push(item);
      }
    }

    // Apply budgets
    const constrained = activeConstraints.slice(0, ACTIVE_CONSTRAINTS_LIMIT);
    const sematicLimited = semanticItems.slice(0, SEMANTIC_MEMORY_LIMIT);

    // Combine: active constraints first, then semantic memory
    const injected = [...constrained, ...sematicLimited];

    // Build stats
    const byCategory: Record<string, number> = {};
    for (const item of injected) {
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    }

    return {
      injected: injected.map(item => ({
        category: item.category,
        subject: item.subject,
        field: item.field,
        value: item.value,
        sourceChapter: item.sourceChapter,
        payload: item.payload ? JSON.parse(item.payload) : undefined,
      })),
      activeConstraints: constrained.map(item => ({
        category: item.category,
        subject: item.subject,
        value: item.value,
      })),
      stats: {
        total: items.length,
        injected: injected.length,
        filtered: items.length - injected.length,
        byCategory,
      },
    };
  } catch (e) {
    logEventError("memoryOrchestrator.build", { novelId, chapterOrder }, e);
    return null;
  }
}

/**
 * Compile a memory pack into formatted text for injection into the
 * LLM prompt as a context block.
 *
 * Groups items by category with human-readable labels. Shows source
 * chapter for traceability. Limits value length to control token usage.
 */
export function compileMemoryPackContent(pack: MemoryPack): string {
  if (pack.injected.length === 0) return "";

  // Group by category
  const byCategory = new Map<string, typeof pack.injected>();

  for (const item of pack.injected) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, []);
    }
    byCategory.get(item.category)!.push(item);
  }

  const lines = ["【语义记忆 — 以下事实从历史章节沉淀，本章创作必须遵守】"];

  for (const [category, items] of byCategory) {
    const label = CATEGORY_LABELS[category] ?? category;
    lines.push("");
    lines.push(`== ${label} ==`);

    for (const item of items) {
      const chapterNote = item.sourceChapter > 0 ? `（第${item.sourceChapter}章）` : "";
      const value = (item.value ?? "").slice(0, 200);
      lines.push(`• ${value}${chapterNote}`);
    }
  }

  // Add a note about filtered items
  if (pack.stats.filtered > 0) {
    lines.push("");
    lines.push(`（共${pack.stats.total}条记忆，注入${pack.stats.injected}条，过滤${pack.stats.filtered}条超出时间窗口）`);
  }

  return lines.join("\n");
}
