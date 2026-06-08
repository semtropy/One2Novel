import { getPrisma } from "../../platform/db/client";
import { mergeStyleRules, resolveBindings } from "./styleBindingResolver";
import type { ResolvedStyleRules } from "./styleBindingResolver";

/**
 * Resolve the effective style context for a given chapter.
 *
 * Pipeline (ADAPTED from OP StyleRuntimeResolver):
 *   resolveBindings(novelId, chapterId) → sort by priority → merge rules → compile prompt blocks
 *
 * Chapter-level bindings override novel-level bindings for same-key rules.
 * Chapter-unique rules are additive (they don't replace novel rules on different keys).
 */
export async function resolveStyleForChapter(
  novelId: string,
  chapterId?: string,
): Promise<ResolvedStyleRules> {
  return mergeStyleRules(novelId, chapterId ?? undefined);
}

/**
 * Return just the style prompt block string (backward compat for context assembler).
 */
export async function resolveStyleBlock(novelId: string, chapterId?: string): Promise<string> {
  const result = await mergeStyleRules(novelId, chapterId ?? undefined);
  return result.styleBlock;
}

/**
 * Return just the anti-AI system prompt block (for chapter writer injection).
 */
export async function resolveAntiAiPrompt(novelId: string, chapterId?: string): Promise<string> {
  const result = await mergeStyleRules(novelId, chapterId ?? undefined);
  return result.antiAiPrompt;
}

/**
 * Resolve full style context — returns both the prompt blocks and metadata
 * for use by contextAssembler, ContextPanel API, and chapter writer.
 */
export async function resolveStyleContext(
  novelId: string,
  chapterId?: string,
) {
  const [rules, bindings] = await Promise.all([
    mergeStyleRules(novelId, chapterId ?? undefined),
    resolveBindings(novelId, chapterId ?? undefined),
  ]);

  // Extract overallDescription from primary binding's profile
  let summary = "";
  if (bindings.length > 0) {
    const primary = bindings[0];
    const prisma = getPrisma();
    const profile = await prisma.styleProfile.findUnique({ where: { id: primary.styleProfileId }, select: { extractedFeatures: true } });
    if (profile?.extractedFeatures) {
      try { summary = JSON.parse(profile.extractedFeatures).overallDescription ?? ""; } catch {}
    }
  }

  return {
    styleBlock: rules.styleBlock,
    antiAiPrompt: rules.antiAiPrompt,
    antiAi: rules.antiAi,
    selfCheck: rules.selfCheck,
    rules: rules.rules,
    sources: rules.sources,
    primaryProfileName: rules.primaryProfileName,
    summary,
    maturity: rules.maturity,
    dedupStats: rules.dedupStats,
    bindings: bindings.map((b) => ({
      id: b.styleProfileId,
      name: b.styleProfileName,
      targetType: b.targetType,
      priority: b.priority,
    })),
  };
}
