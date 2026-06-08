/**
 * StyleCompiler — compiles merged style rules into structured prompt blocks.
 *
 * ADAPTED from OP StyleCompiler.ts (353 lines). Enhanced for One2Novel Phase 7.1:
 * - Rule deduplication (exact + near-duplicate)
 * - Priority sorting (by weight, then targetType specificity)
 * - Weight-based directive resolution (3 tiers)
 * - Anti-AI rule categorization + compilation into system prompt
 */

// ─── Types ─────────────────────────────────────────────

export interface StyleRule {
  text: string;
  /** Field label: 叙事 | 语言 | 角色 | 节奏 | 反AI */
  field: string;
  /** Binding target type: novel | chapter */
  targetType: string;
  /** Binding weight (0–1), drives directive strength */
  weight: number;
}

export interface CompileInput {
  rules: StyleRule[];
  sources: Array<{ name: string; targetType: string }>;
  primaryProfileName: string | null;
}

export interface CompiledStyleBlocks {
  /** Full style prompt block for user-prompt injection */
  style: string;
  /** Condensed anti-AI constraint block for system-prompt injection */
  antiAiPrompt: string;
  /** Full anti-AI block for reference / UI display */
  antiAi: string;
  /** Self-check instructions for post-generation review */
  selfCheck: string;
  /** Human-readable context line for binding sources */
  context: string;
  /** Whether the profile has enough rules to be meaningful */
  maturity: "summary_only" | "partial" | "full";
  /** Dedup stats for debugging */
  dedupStats: { total: number; kept: number; dropped: number };
}

// ─── Constants ─────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  "叙事": "叙事",
  "语言": "语言",
  "角色": "角色",
  "节奏": "节奏",
  "反AI": "反AI",
};

const TARGET_LABELS: Record<string, string> = {
  novel: "全书法则",
  chapter: "本章绑定",
};

/** Chapter bindings are more specific → sort before novel */
const TARGET_PRIORITY: Record<string, number> = {
  chapter: 2,
  novel: 1,
};

// ─── Text Normalization ────────────────────────────────

/** Normalize Chinese text for dedup comparison */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/[！!]/g, "!")
    .replace(/[，,]/g, ",")
    .replace(/[。.]/g, ".")
    .replace(/[：:]/g, ":")
    .replace(/[；;]/g, ";")
    .replace(/[？?]/g, "?")
    .replace(/[「『]/g, "\"")
    .replace(/[」』]/g, "\"")
    .toLowerCase();
}

// ─── Deduplication ─────────────────────────────────────

interface DedupResult {
  kept: StyleRule[];
  dropped: number;
}

/**
 * Deduplicate rules. Strategy:
 * 1. Exact match after normalization → keep highest weight
 * 2. Subsumption (one text contains ≥80% of another) → keep longer + higher weight
 * 3. High Jaccard similarity (>0.75) on character bigrams → keep higher weight
 */
function deduplicateRules(rules: StyleRule[]): DedupResult {
  if (rules.length <= 1) return { kept: [...rules], dropped: 0 };

  const kept: StyleRule[] = [];
  const dropped = new Set<number>();

  for (let i = 0; i < rules.length; i++) {
    if (dropped.has(i)) continue;
    let survivor = rules[i];

    for (let j = i + 1; j < rules.length; j++) {
      if (dropped.has(j)) continue;
      const candidate = rules[j];

      const normA = normalizeText(survivor.text);
      const normB = normalizeText(candidate.text);

      // Exact match
      if (normA === normB) {
        if (candidate.weight > survivor.weight) survivor = candidate;
        dropped.add(survivor === rules[i] ? j : i);
        continue;
      }

      // Subsumption: one text contains the other
      if (normA.includes(normB) || normB.includes(normA)) {
        const longer = normA.length >= normB.length ? survivor : candidate;
        const shorter = longer === survivor ? candidate : survivor;
        // If shorter is ≥60% of longer, treat as duplicate
        if (shorter.text.length / longer.text.length >= 0.6) {
          survivor = longer.weight >= shorter.weight ? longer : shorter;
          dropped.add(survivor === candidate ? j : i);
          if (survivor === candidate) break; // Restart inner loop with new survivor
        }
        continue;
      }

      // Jaccard similarity on character bigrams (expensive, only for close-length strings)
      const lenDiff = Math.abs(normA.length - normB.length) / Math.max(normA.length, normB.length);
      if (lenDiff < 0.3) {
        const similarity = bigramJaccard(normA, normB);
        if (similarity > 0.75) {
          if (candidate.weight > survivor.weight) survivor = candidate;
          dropped.add(survivor === rules[i] ? j : i);
          if (survivor === candidate) break;
        }
      }
    }

    kept.push(survivor);
  }

  return { kept, dropped: rules.length - kept.length };
}

/** Jaccard similarity on character bigrams */
function bigramJaccard(a: string, b: string): number {
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  const intersection = new Set([...bigramsA].filter((x) => bigramsB.has(x)));
  const union = new Set([...bigramsA, ...bigramsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── Priority Sorting ──────────────────────────────────

/**
 * Sort rules within each field:
 * 1. By weight descending (higher weight = higher directive strength)
 * 2. By targetType specificity descending (chapter > novel)
 */
function sortRulesByPriority(rules: StyleRule[]): StyleRule[] {
  return rules.slice().sort((a, b) => {
    const weightDiff = b.weight - a.weight;
    if (Math.abs(weightDiff) > 0.01) return weightDiff;
    return (TARGET_PRIORITY[b.targetType] ?? 0) - (TARGET_PRIORITY[a.targetType] ?? 0);
  });
}

// ─── Weight-based Directives ───────────────────────────

/** Resolve directive word based on rule weight (from OP three-tier model) */
function resolveDirective(weight: number): string {
  if (weight >= 0.85) return "必须遵守";
  if (weight >= 0.65) return "优先遵守";
  return "尽量遵守";
}

// ─── Anti-AI Categorization ────────────────────────────

type AntiAiCategory = "forbidden" | "risk" | "encourage";

interface CategorizedAntiAi {
  category: AntiAiCategory;
  rule: StyleRule;
}

/**
 * Categorize anti-AI rules by content pattern matching.
 * - forbidden: "禁止"/"不得"/"严禁"/"不能"/"不许"
 * - risk: "避免"/"减少"/"慎用"/"注意"/"尽量不"/"少用"
 * - encourage: "建议"/"推荐"/"多用"/"可以"/"应该"/"优先"
 */
function categorizeAntiAiRule(rule: StyleRule): AntiAiCategory {
  const t = rule.text;
  if (/禁止|不得|严禁|不能|不许|杜绝|绝不|切勿/.test(t)) return "forbidden";
  if (/避免|减少|慎用|注意|尽量不|少用|限制|克制/.test(t)) return "risk";
  if (/建议|推荐|多用|可以|应该|优先|提倡|鼓励/.test(t)) return "encourage";
  // Default: if it sounds prescriptive → forbidden; advisory → risk
  if (/不要|别|停止|戒除/.test(t)) return "forbidden";
  return "risk";
}

/**
 * Compile anti-AI rules into a compact system-prompt-injectable block.
 * Groups by category (forbidden → risk → encourage) with weight-based verb.
 */
function compileAntiAiPromptBlock(rules: StyleRule[]): string {
  const categorized: CategorizedAntiAi[] = rules.map((r) => ({
    category: categorizeAntiAiRule(r),
    rule: r,
  }));

  const forbidden = categorized.filter((c) => c.category === "forbidden");
  const risk = categorized.filter((c) => c.category === "risk");
  const encourage = categorized.filter((c) => c.category === "encourage");

  const lines: string[] = [];
  lines.push("## 反AI写作约束（系统硬约束，必须在生成时遵守）");

  if (forbidden.length > 0) {
    lines.push("### 严格禁止");
    for (const { rule } of forbidden) {
      const dir = resolveDirective(rule.weight);
      lines.push(`- [${dir}] ${rule.text}`);
    }
  }

  if (risk.length > 0) {
    lines.push("### 高度警惕");
    for (const { rule } of risk) {
      const dir = resolveDirective(rule.weight);
      lines.push(`- [${dir}] ${rule.text}`);
    }
  }

  if (encourage.length > 0) {
    lines.push("### 鼓励方向");
    for (const { rule } of encourage) {
      lines.push(`- ${rule.text}`);
    }
  }

  return lines.join("\n");
}

/**
 * Compile anti-AI rules into a full reference block (for user-prompt / UI display).
 */
function compileAntiAiFullBlock(rules: StyleRule[]): string {
  if (rules.length === 0) return "";

  const categorized: CategorizedAntiAi[] = rules.map((r) => ({
    category: categorizeAntiAiRule(r),
    rule: r,
  }));

  const forbidden = categorized.filter((c) => c.category === "forbidden");
  const risk = categorized.filter((c) => c.category === "risk");
  const encourage = categorized.filter((c) => c.category === "encourage");

  const lines: string[] = [];
  lines.push("## 反AI约束");

  if (forbidden.length > 0) {
    lines.push("### 禁止");
    for (const { rule } of forbidden) {
      lines.push(`- 禁止：${rule.text}`);
    }
  }

  if (risk.length > 0) {
    lines.push("### 风险提示");
    for (const { rule } of risk) {
      lines.push(`- 注意：${rule.text}`);
    }
  }

  if (encourage.length > 0) {
    lines.push("### 鼓励");
    for (const { rule } of encourage) {
      lines.push(`- 鼓励：${rule.text}`);
    }
  }

  return lines.join("\n");
}

// ─── Core Compilation ──────────────────────────────────

/**
 * Compile merged style rules into structured prompt blocks.
 *
 * Pipeline:
 *   1. Deduplicate rules (exact + near-duplicate)
 *   2. Sort by weight priority within each field
 *   3. Group by field → render sections
 *   4. Separate anti-AI rules → compile into system-prompt block + full block
 *   5. Generate self-check + context line + maturity
 */
export function compileStyleBlocks(input: CompileInput): CompiledStyleBlocks {
  const { rules: rawRules, sources, primaryProfileName } = input;

  // 1. Dedup
  const { kept: dedupedRules, dropped } = deduplicateRules(rawRules);

  // 2. Separate anti-AI from writing rules
  const antiAiRules = dedupedRules.filter((r) => r.field === "反AI");
  const writingRules = dedupedRules.filter((r) => r.field !== "反AI");

  // 3. Group writing rules by field
  const grouped = new Map<string, StyleRule[]>();
  for (const r of writingRules) {
    const list = grouped.get(r.field) ?? [];
    list.push(r);
    grouped.set(r.field, list);
  }

  // 4. Sort within each field group
  for (const [field, fieldRules] of grouped) {
    grouped.set(field, sortRulesByPriority(fieldRules));
  }

  // 5. Build context line
  const novelSources = sources.filter((s) => s.targetType === "novel");
  const chapterSources = sources.filter((s) => s.targetType === "chapter");
  const contextParts: string[] = [];
  if (novelSources.length > 0) {
    contextParts.push(`全书法则：${novelSources.map((s) => s.name).join("、")}`);
  }
  if (chapterSources.length > 0) {
    contextParts.push(`本章绑定：${chapterSources.map((s) => s.name).join("、")}`);
  }
  const context = contextParts.length > 0
    ? `写法约束 | ${contextParts.join(" | ")}`
    : "";

  // 6. Compile writing style sections
  const sections: string[] = [];
  let totalRules = 0;

  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    if (field === "反AI") continue; // handled separately

    const fieldRules = grouped.get(field);
    if (!fieldRules || fieldRules.length === 0) continue;

    totalRules += fieldRules.length;

    const lines: string[] = [];
    for (let i = 0; i < fieldRules.length; i++) {
      const r = fieldRules[i];
      const dir = resolveDirective(r.weight);
      const isChapter = r.targetType === "chapter";
      const marker = isChapter ? "【本章优先】" : "";
      lines.push(`${i + 1}. ${dir}：${marker}${r.text}`);
    }

    sections.push(`### ${label}\n${lines.join("\n")}`);
  }

  // 7. Compile anti-AI blocks
  totalRules += antiAiRules.length;
  const sortedAntiAi = sortRulesByPriority(antiAiRules);
  const antiAiPrompt = compileAntiAiPromptBlock(sortedAntiAi);
  const antiAi = compileAntiAiFullBlock(sortedAntiAi);

  // 8. Self-check (from OP, adapted to Chinese)
  const selfCheck = [
    "- 检查正文是否用解释代替了展示（如直接陈述情感而非用动作/对话表现）",
    "- 检查段落结尾是否出现总结、升华或说教倾向",
    "- 检查句式节奏是否过于均匀或模板化",
    "- 检查是否存在连续三句以上相同主语开头",
    "- 如有 AI 痕迹，请在输出定稿前修正",
  ].join("\n");

  // 9. Maturity
  const maturity: CompiledStyleBlocks["maturity"] =
    totalRules >= 8 ? "full" : totalRules >= 3 ? "partial" : "summary_only";

  // 10. Assemble final style block
  const header = context
    ? `## ${context}\n以下写作约束适用于本章正文生成，请严格遵循。`
    : "## 写法约束\n以下为全局写作约束，请严格遵循。";

  // Anti-AI section appended to style block for user prompt
  const antiAiSection = antiAi
    ? `\n\n${antiAi}`
    : "";

  const selfCheckSection = sections.length > 0
    ? `\n\n### 自查清单\n${selfCheck}`
    : "";

  const style = [
    header,
    ...sections,
    antiAiSection,
    selfCheckSection,
  ].filter(Boolean).join("\n\n");

  return {
    style,
    antiAiPrompt,
    antiAi,
    selfCheck: `### 自查清单\n${selfCheck}`,
    context,
    maturity,
    dedupStats: { total: rawRules.length, kept: dedupedRules.length, dropped },
  };
}
