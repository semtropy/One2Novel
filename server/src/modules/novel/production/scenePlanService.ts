import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { assembleChapterContext } from "./contextAssembler";

// ─── Types ──────────────────────────────────────────

const SceneSchema = z.object({
  title: z.string().min(1).max(50),
  summary: z.string().min(1).max(200),
  povCharacter: z.string().optional(),
  participants: z.array(z.string()).optional(),
  goal: z.string().optional(),
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  estimatedWords: z.number().int().min(100).max(3000).optional(),
});

const ScenePlanOutputSchema = z.object({
  scenes: z.array(SceneSchema).min(2).max(8),
});

export interface Scene {
  id: string;
  order: number;
  title: string;
  summary: string;
  povCharacter?: string;
  participants?: string[];
  goal?: string;
  location?: string;
  timeOfDay?: string;
  estimatedWords?: number;
}

export interface ScenePlan {
  scenes: Scene[];
  scenePlanGenerated: boolean;
  generatedAt?: string;
  enabled: boolean;
}

// ─── Helpers ───────────────────────────────────────

function cuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseScenePlan(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ─── Public API ────────────────────────────────────

export async function getScenePlan(novelId: string, chapterId: string): Promise<ScenePlan | null> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { scenePlan: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  const cards = parseScenePlan(chapter.scenePlan);
  if (!cards.scenes || !Array.isArray(cards.scenes)) return null;

  return {
    scenes: cards.scenes as Scene[],
    scenePlanGenerated: !!cards.scenePlanGenerated,
    generatedAt: typeof cards.generatedAt === "string" ? cards.generatedAt : undefined,
    enabled: cards.enabled !== false,
  };
}

export async function generateScenePlan(novelId: string, chapterId: string): Promise<ScenePlan> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { title: true, expectation: true, order: true, scenePlan: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  // Assemble context for scene planning (lighter than full writing context)
  const ctx = await assembleChapterContext(novelId, chapterId);

  const userPrompt = [
    `书名：《${ctx.novelTitle}》${ctx.novelGenre ? ` · ${ctx.novelGenre}` : ""}`,
    `第${ctx.chapterOrder}章《${ctx.chapterTitle}》`,
    "",
    `章节目标：${ctx.chapterExpectation ?? "推进主线"}`,
    ctx.chapterHook ? `章尾悬念方向：${ctx.chapterHook}` : "",
    "",
    ctx.characters ? `出场角色：\n${ctx.characters}` : "",
    "",
    ctx.previousChapters ? `前情提要：\n${ctx.previousChapters.slice(0, 800)}` : "",
    "",
    ctx.payoffContext || "",
    "",
    `请为这一章规划3-6个场景，总字数控制在3000-5000字。`,
  ].filter(Boolean).join("\n");

  const result = await aiInvoke({
    assetId: "novel.scene-plan.generate",
    userPrompt,
    schema: ScenePlanOutputSchema,
    temperature: 0.7,
  });

  const now = new Date().toISOString();
  const scenes: Scene[] = result.scenes.map((s, i) => ({
    id: cuid(),
    order: i + 1,
    title: s.title,
    summary: s.summary,
    povCharacter: s.povCharacter,
    participants: s.participants,
    goal: s.goal,
    location: s.location,
    timeOfDay: s.timeOfDay,
    estimatedWords: s.estimatedWords ?? Math.round(3000 / result.scenes.length),
  }));

  // Persist to scenePlan JSON
  const existing = parseScenePlan(chapter.scenePlan);
  existing.scenes = scenes;
  existing.scenePlanGenerated = true;
  existing.generatedAt = now;
  existing.enabled = true;

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { scenePlan: JSON.stringify(existing) },
  });

  return { scenes, scenePlanGenerated: true, generatedAt: now, enabled: true };
}

export async function updateScenePlan(
  novelId: string,
  chapterId: string,
  scenes: Scene[],
): Promise<ScenePlan> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { scenePlan: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  const existing = parseScenePlan(chapter.scenePlan);

  // Re-number order by array position
  const reordered = scenes.map((s, i) => ({ ...s, order: i + 1 }));

  existing.scenes = reordered;
  existing.scenePlanGenerated = true;
  existing.generatedAt = existing.generatedAt ?? new Date().toISOString();

  await prisma.chapter.update({
    where: { id: chapterId },
    data: { scenePlan: JSON.stringify(existing) },
  });

  return {
    scenes: reordered,
    scenePlanGenerated: true,
    generatedAt: existing.generatedAt as string,
    enabled: existing.enabled !== false,
  };
}

export async function toggleScenePlan(
  novelId: string, chapterId: string, enabled: boolean,
): Promise<{ enabled: boolean }> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { scenePlan: true },
  });
  if (!chapter) throw new Error("Chapter not found");
  const existing = parseScenePlan(chapter.scenePlan);
  existing.enabled = enabled;
  await prisma.chapter.update({
    where: { id: chapterId },
    data: { scenePlan: JSON.stringify(existing) },
  });
  return { enabled };
}

/**
 * Compile scene plan into a prompt block for the chapter writer.
 * Format: numbered scene list with key info, designed to be injected
 * into the user prompt as a structural constraint.
 */
export function compileScenePlanContext(plan: ScenePlan): string {
  if (!plan.scenes || plan.scenes.length === 0) return "";

  const lines = plan.scenes.map((s) => {
    const parts = [`${s.order}. ${s.title}`];
    parts.push(`   摘要：${s.summary}`);
    if (s.goal) parts.push(`   目标：${s.goal}`);
    if (s.location) parts.push(`   地点：${s.location}`);
    if (s.povCharacter) parts.push(`   视点：${s.povCharacter}`);
    if (s.participants?.length) parts.push(`   出场：${s.participants.join("、")}`);
    if (s.estimatedWords) parts.push(`   字数：约${s.estimatedWords}字`);
    return parts.join("\n");
  });

  return `## 分镜计划（按序执行，共${plan.scenes.length}个场景）\n${lines.join("\n\n")}\n\n请按照分镜计划的顺序写作，每个场景以自然过渡连接，场景边界无需标注。`;
}
