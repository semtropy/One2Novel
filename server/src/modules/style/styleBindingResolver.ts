import { getPrisma } from "../../platform/db/client";
import { compileStyleBlocks } from "./styleCompiler";
import type { StyleRule } from "./styleCompiler";

/** Binding priority: chapter-level overrides novel-level */
const TARGET_PRIORITY: Record<string, number> = { novel: 1, chapter: 2 };

export interface ResolvedBinding {
  styleProfileId: string;
  styleProfileName: string;
  targetType: string;
  targetId: string;
  priority: number;
  weight: number;
}

export interface ResolvedStyleRules {
  /** Merged rule text block ready for user-prompt injection (includes anti-AI section) */
  styleBlock: string;
  /** Condensed anti-AI constraint block for system-prompt injection */
  antiAiPrompt: string;
  /** Full anti-AI block for reference / UI display */
  antiAi: string;
  /** Self-check instructions */
  selfCheck: string;
  /** Flat list of individual rules (for display / debugging) */
  rules: string[];
  /** Which profiles contributed (for UI display) */
  sources: Array<{ name: string; targetType: string; ruleCount: number }>;
  /** The primary (highest priority) profile name */
  primaryProfileName: string | null;
  /** Compilation maturity */
  maturity: "summary_only" | "partial" | "full";
  /** Dedup stats */
  dedupStats: { total: number; kept: number; dropped: number };
}

/**
 * Query all effective bindings for a novel + optional chapter.
 * Returns bindings sorted by priority (chapter > novel) then by weight.
 */
export async function resolveBindings(
  novelId: string,
  chapterId?: string,
): Promise<ResolvedBinding[]> {
  const prisma = getPrisma();
  const bindings = await prisma.styleBinding.findMany({
    where: {
      enabled: true,
      OR: [
        { targetType: "novel", targetId: novelId },
        ...(chapterId ? [{ targetType: "chapter" as const, targetId: chapterId }] : []),
      ],
    },
    include: { styleProfile: { select: { id: true, name: true } } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });

  return bindings
    .map((b) => ({
      styleProfileId: b.styleProfileId,
      styleProfileName: b.styleProfile.name,
      targetType: b.targetType,
      targetId: b.targetId,
      priority: b.priority,
      weight: b.weight,
    }))
    .sort((a, b) => {
      // Chapter bindings sort before novel bindings
      const tp = (TARGET_PRIORITY[b.targetType] ?? 0) - (TARGET_PRIORITY[a.targetType] ?? 0);
      if (tp !== 0) return tp;
      return b.priority - a.priority;
    });
}

/**
 * Merge rules from multiple profiles into a single style context block.
 *
 * Merge strategy (ADAPTED from OP StyleBindingService, enhanced Phase 7.1):
 * 1. Chapter-level rules override novel-level rules with the same key
 * 2. Novel-level rules fill in gaps where chapter has no rule
 * 3. Rules carry binding weight for directive strength
 * 4. Deduplication is handled by StyleCompiler
 */
export async function mergeStyleRules(
  novelId: string,
  chapterId?: string,
): Promise<ResolvedStyleRules> {
  const bindings = await resolveBindings(novelId, chapterId);
  const prisma = getPrisma();

  const RULE_FIELDS = [
    "narrativeRules",
    "languageRules",
    "characterRules",
    "rhythmRules",
    "antiAiRules",
  ] as const;

  type RuleField = (typeof RULE_FIELDS)[number];

  function fieldLabel(f: string): string {
    switch (f) {
      case "narrativeRules": return "叙事";
      case "languageRules": return "语言";
      case "characterRules": return "角色";
      case "rhythmRules": return "节奏";
      case "antiAiRules": return "反AI";
      default: return f;
    }
  }

  // Map: `${field}:${ruleText}` → StyleRule (with dedup override by targetType priority)
  const ruleMap = new Map<string, StyleRule>();
  const sourceCounts = new Map<string, { name: string; targetType: string; ruleCount: number }>();

  for (const binding of bindings) {
    const profile = await prisma.styleProfile.findUnique({
      where: { id: binding.styleProfileId },
      select: { name: true, narrativeRules: true, languageRules: true, characterRules: true, rhythmRules: true, antiAiRules: true },
    });
    if (!profile) continue;

    let profileRuleCount = 0;

    for (const field of RULE_FIELDS) {
      try {
        const arr: string[] = JSON.parse((profile as Record<string, string>)[field] ?? "[]");
        if (!Array.isArray(arr)) continue;

        for (const ruleText of arr) {
          const key = `${field}:${ruleText}`;
          const existing = ruleMap.get(key);

          // Chapter-level (>novel) or higher-weight overrides existing
          if (!existing
            || TARGET_PRIORITY[binding.targetType] > TARGET_PRIORITY[existing.targetType]
            || (TARGET_PRIORITY[binding.targetType] === TARGET_PRIORITY[existing.targetType] && binding.weight > existing.weight)
          ) {
            ruleMap.set(key, {
              text: ruleText,
              field: fieldLabel(field),
              targetType: binding.targetType,
              weight: binding.weight,
            });
            profileRuleCount++;
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }

    const sourceKey = `${binding.styleProfileName}:${binding.targetType}`;
    const prev = sourceCounts.get(sourceKey);
    sourceCounts.set(sourceKey, {
      name: binding.styleProfileName,
      targetType: binding.targetType,
      ruleCount: (prev?.ruleCount ?? 0) + profileRuleCount,
    });
  }

  const rules = [...ruleMap.values()];
  const sources = [...sourceCounts.values()].filter((s) => s.ruleCount > 0);
  const primaryProfileName = bindings[0]?.styleProfileName ?? null;

  // Compile rules into structured prompt blocks via StyleCompiler
  const compiled = compileStyleBlocks({ rules, sources, primaryProfileName });

  return {
    styleBlock: compiled.style,
    antiAiPrompt: compiled.antiAiPrompt,
    antiAi: compiled.antiAi,
    selfCheck: compiled.selfCheck,
    rules: rules.map((r) => `[${r.field}] ${r.text}`),
    sources,
    primaryProfileName,
    maturity: compiled.maturity,
    dedupStats: compiled.dedupStats,
  };
}
