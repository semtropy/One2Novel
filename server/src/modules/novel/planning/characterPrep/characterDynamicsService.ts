import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";

// ─── Volume Dynamics ─────────────────────────────────

const VolumeDynamicsSchema = z.object({
  assignments: z.array(z.object({
    characterName: z.string(),
    roleInVolume: z.string(),
    mustDo: z.array(z.string()),
    mustAvoid: z.array(z.string()),
    arcPhase: z.string(),
  })),
  factionTracks: z.array(z.object({
    faction: z.string(),
    members: z.array(z.string()),
    goal: z.string(),
    status: z.string(),
    tensionDirection: z.string(),
  })),
  relationStages: z.array(z.object({
    charA: z.string(),
    charB: z.string(),
    stage: z.string(),
    expectedShift: z.string(),
    triggerEvent: z.string(),
  })),
  summary: z.string(),
});

export interface VolumeDynamics {
  assignments: Array<{
    characterName: string; roleInVolume: string;
    mustDo: string[]; mustAvoid: string[]; arcPhase: string;
  }>;
  factionTracks: Array<{
    faction: string; members: string[]; goal: string;
    status: string; tensionDirection: string;
  }>;
  relationStages: Array<{
    charA: string; charB: string; stage: string;
    expectedShift: string; triggerEvent: string;
  }>;
  summary: string;
}

export async function generateVolumeDynamics(
  novelId: string,
  volumeId: string,
): Promise<VolumeDynamics> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { structuredOutline: true, genre: true },
  });
  const volume = await prisma.volume.findUnique({
    where: { id: volumeId },
    include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } },
  });
  const characters = await prisma.novelCharacter.findMany({ where: { novelId } });

  if (!volume) throw new Error("Volume not found");

  const charLines = characters.map(c =>
    `${c.name}(${c.role})：性格${c.personality ?? ""}，目标${c.currentGoal ?? ""}，身份${c.identityLabel ?? ""}`);
  const volLines = [
    `第${volume.sortOrder}卷《${volume.title}》：${volume.summary ?? ""}`,
    `章节数：${volume.chapterPlans.length}`,
    ...volume.chapterPlans.map(p => `  - 第${p.chapterOrder}章 ${p.title}：${p.summary ?? ""}`),
  ];

  
  const userPrompt = [
    "## 角色阵容",
    charLines.join("\n"),
    "",
    "## 本卷结构",
    volLines.join("\n"),
    "",
    novel?.structuredOutline ? `## 全书大纲\n${novel.structuredOutline.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n");

  return aiInvoke({
    assetId: "novel.character.dynamics.volume",
    templateVars: { genre: novel?.genre ?? "" },
    userPrompt,
    schema: VolumeDynamicsSchema,
    temperature: 0.6,
  });
}

// ─── Chapter Dynamics ────────────────────────────────

const ChapterDynamicsSchema = z.object({
  shouldAppear: z.array(z.object({
    name: z.string(),
    reason: z.string(),
    mustHaveScene: z.boolean(),
    sceneGoal: z.string(),
  })),
  absenceRisk: z.array(z.object({
    name: z.string(),
    chaptersSinceLastAppearance: z.number(),
    risk: z.string(),
    suggestion: z.string(),
  })),
  relationEvolves: z.array(z.object({
    charA: z.string(),
    charB: z.string(),
    currentStage: z.string(),
    thisChapterShift: z.string(),
    sceneMechanism: z.string(),
  })),
  statusUpdates: z.array(z.object({
    name: z.string(),
    currentGoal: z.string(),
    currentLocation: z.string(),
    chapterGoal: z.string(),
  })),
});

export interface ChapterDynamics {
  shouldAppear: Array<{
    name: string; reason: string; mustHaveScene: boolean; sceneGoal: string;
  }>;
  absenceRisk: Array<{
    name: string; chaptersSinceLastAppearance: number; risk: string; suggestion: string;
  }>;
  relationEvolves: Array<{
    charA: string; charB: string; currentStage: string;
    thisChapterShift: string; sceneMechanism: string;
  }>;
  statusUpdates: Array<{
    name: string; currentGoal: string; currentLocation: string; chapterGoal: string;
  }>;
}

export async function generateChapterDynamics(
  novelId: string,
  chapterId: string,
): Promise<ChapterDynamics> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { chapterSummary: true },
  });
  if (!chapter) throw new Error("Chapter not found");

  const characters = await prisma.novelCharacter.findMany({ where: { novelId } });
  const recentChapters = await prisma.chapter.findMany({
    where: { novelId, chapterStatus: { in: ["drafted", "completed"] } },
    orderBy: { order: "desc" }, take: 10,
    select: { order: true, title: true, expectation: true, content: true },
  });

  // Track character appearance gap
  const charGaps = characters.map(c => {
    const lastAppearance = recentChapters.find(ch =>
      ch.content?.includes(c.name));
    const gap = lastAppearance ? chapter.order - lastAppearance.order : chapter.order;
    return { name: c.name, role: c.role, chaptersSinceLastAppearance: gap };
  });

  
  const userPrompt = [
    `## 本章`,
    `第${chapter.order}章《${chapter.title}》`,
    `章节目标：${chapter.expectation ?? "推进主线"}`,
    "",
    "## 角色阵容与出场间隔",
    ...charGaps.map(c => `- ${c.name}(${c.role})：距上次出场${c.chaptersSinceLastAppearance}章${c.chaptersSinceLastAppearance >= 3 ? " ⚠️缺席风险" : ""}`),
    "",
    "## 最近章节",
    ...recentChapters.slice(0, 5).reverse().map(ch =>
      `第${ch.order}章：${ch.expectation ?? ""}`),
    "",
    "请输出本章角色调度建议。",
  ].join("\n");

  return aiInvoke({
    assetId: "novel.character.dynamics.chapter",
    userPrompt,
    schema: ChapterDynamicsSchema,
    temperature: 0.4,
  });
}

/**
 * Compile character dynamics into a context block for the writer.
 * Used by contextAssembler to inject into the writing context.
 */
export function compileDynamicsContext(dynamics: ChapterDynamics): string {
  const lines: string[] = ["## 角色动态调度"];

  if (dynamics.shouldAppear.length > 0) {
    lines.push("### 本章应出场角色");
    const hardRequired = dynamics.shouldAppear.filter(c => c.mustHaveScene);
    if (hardRequired.length > 0) {
      lines.push("【硬约束 — 以下角色必须在本章有实质性出场，不可省略】");
      for (const c of hardRequired) {
        lines.push(`- 🔴 ${c.name}：${c.reason} —— ${c.sceneGoal}`);
      }
    }
    const suggested = dynamics.shouldAppear.filter(c => !c.mustHaveScene);
    if (suggested.length > 0) {
      lines.push("【建议出场】");
      for (const c of suggested) {
        lines.push(`- ${c.name}：${c.reason} —— ${c.sceneGoal}`);
      }
    }
  }

  if (dynamics.absenceRisk.length > 0) {
    lines.push("\n### 缺席风险");
    for (const r of dynamics.absenceRisk) {
      lines.push(`- ⚠️ ${r.name}：距上次出场${r.chaptersSinceLastAppearance}章，${r.risk}。建议：${r.suggestion}`);
    }
  }

  if (dynamics.relationEvolves.length > 0) {
    lines.push("\n### 关系演进");
    for (const r of dynamics.relationEvolves) {
      lines.push(`- ${r.charA} ↔ ${r.charB}：${r.currentStage} → ${r.thisChapterShift}（${r.sceneMechanism}）`);
    }
  }

  return lines.join("\n");
}
