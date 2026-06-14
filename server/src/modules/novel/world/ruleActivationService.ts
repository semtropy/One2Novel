/**
 * Rule Activation Service — on-demand activation of world rules per chapter.
 * Only relevant rules are injected into the writing context (≤600 char budget).
 */

import { getPrisma } from "../../../platform/db/client";
import { listRules, type WorldRuleData } from "./worldRuleService";

// ─── Simple in-memory cache (TTL: 1 volume worth of chapters) ──
const relevanceCache = new Map<string, { ruleIds: string[]; expiresAt: number }>();

function cacheKey(novelId: string, chapterContext: string): string {
  // Hash chapter context to a short key: use novelId + first 100 chars of context
  return `${novelId}:${chapterContext.slice(0, 100)}`;
}

// ─── Relevance scoring ─────────────────────────────────

/** Score how relevant a world rule is to a chapter based on keyword matching */
function relevanceScore(rule: WorldRuleData, chapterContext: string): number {
  let score = 0;
  const ctx = chapterContext.toLowerCase();

  // Extract key terms from rule title + content
  const terms = `${rule.title} ${rule.content} ${rule.category}`.toLowerCase()
    .replace(/[，。；：！？、\s]+/g, " ")
    .split(" ")
    .filter(t => t.length >= 2);

  for (const term of terms) {
    if (ctx.includes(term)) score += 3;
  }

  // Certain categories are more likely to be relevant
  if (rule.category === "力量体系" && /修炼|魔法|能力|力量|功法|灵力/.test(ctx)) score += 5;
  if (rule.category === "势力格局" && /势力|门派|家族|组织|阵营/.test(ctx)) score += 5;
  if (rule.category === "地理环境" && /地点|城|山|海|森林|沙漠|地域/.test(ctx)) score += 5;
  if (rule.category === "资源规则" && /资源|灵石|丹药|宝物|材料|装备/.test(ctx)) score += 5;

  return score;
}

// ─── Core functions ────────────────────────────────────

export async function selectRelevantRules(
  novelId: string,
  chapterContext: string,
  maxRules = 5,
): Promise<WorldRuleData[]> {
  const rules = await listRules(novelId);
  const active = rules.filter(r => r.status === "active");
  if (active.length === 0) return [];

  // Check cache (1-hour TTL for same chapter context)
  const key = cacheKey(novelId, chapterContext);
  const cached = relevanceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const cachedRules = active.filter(r => cached.ruleIds.includes(r.id));
    if (cachedRules.length > 0) return cachedRules.slice(0, maxRules);
  }

  // Score and sort
  const scored = active
    .map(r => ({ rule: r, score: relevanceScore(r, chapterContext) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority)
    .slice(0, maxRules);

  const result = scored.map(s => s.rule);

  // Cache
  relevanceCache.set(key, {
    ruleIds: result.map(r => r.id),
    expiresAt: Date.now() + 3600_000, // 1 hour
  });

  return result;
}

export async function activateRulesForChapter(
  novelId: string,
  chapterId: string,
  chapterContext: string,
): Promise<string[]> {
  const prisma = getPrisma();
  const relevant = await selectRelevantRules(novelId, chapterContext);

  const ruleIds = relevant.map(r => r.id);

  // Update each rule's activatedAt
  for (const ruleId of ruleIds) {
    const rule = await prisma.worldRule.findUnique({ where: { id: ruleId } });
    const activated: string[] = rule?.activatedAt ? JSON.parse(rule.activatedAt) : [];
    if (!activated.includes(chapterId)) {
      activated.push(chapterId);
      await prisma.worldRule.update({
        where: { id: ruleId },
        data: { activatedAt: JSON.stringify(activated) },
      });
    }
  }

  // Store on chapter
  await prisma.chapter.update({
    where: { id: chapterId },
    data: { activeWorldRules: JSON.stringify(ruleIds) },
  });

  return ruleIds;
}

export function getActiveRulesContext(rules: WorldRuleData[]): string {
  if (rules.length === 0) return "";

  // Group by category
  const grouped = new Map<string, WorldRuleData[]>();
  for (const r of rules) {
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }

  const sections: string[] = [];
  for (const [cat, catRules] of grouped) {
    const items = catRules.map(r => `- ${r.title}：${r.content}${r.priority >= 8 ? "【不可违背】" : ""}`).join("\n");
    sections.push(`### ${cat}\n${items}`);
  }

  const context = `## 世界规则（本章相关）\n${sections.join("\n\n")}`;

  // Budget: cap at 600 chars
  return context.length <= 600 ? context : context.slice(0, 597) + "...";
}

export async function suggestActivation(novelId: string, chapterContent: string, chapterContext: string) {
  const rules = await listRules(novelId);
  const active = rules.filter(r => r.status === "active");

  // Simple detection: if a rule's key terms appear in chapter content, mark it
  const suggested: string[] = [];
  const stripped = chapterContent.replace(/<[^>]*>/g, "").toLowerCase();

  for (const rule of active) {
    const terms = `${rule.title} ${rule.content}`.toLowerCase()
      .replace(/[，。；：！？、\s]+/g, " ")
      .split(" ")
      .filter(t => t.length >= 3);

    const matchCount = terms.filter(t => stripped.includes(t)).length;
    if (matchCount >= terms.length * 0.3) {
      suggested.push(rule.id);
    }
  }

  return { suggestedRuleIds: suggested };
}
