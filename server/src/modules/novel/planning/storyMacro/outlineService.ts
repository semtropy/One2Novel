import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { getPrisma } from "../../../../platform/db/client";
import { generateBeatSheet } from "../volumeStrategy";
import { validateOutline, type ValidationReport } from "./constraintEngine";
import { injectSkillRules } from "../../../../platform/llm/skillRules";

// Note: chapter/volume indices + chapters array are optional with server-side defaults
const LLMChapterSchema = z.object({
  chapter: z.number().int().optional(), title: z.string(), coreEvent: z.string().optional(),
  hook: z.string().optional(), summary: z.string().optional(), characters: z.array(z.string()).optional(),
});
const LLMVolumeSchema = z.object({
  volume: z.number().int().optional(), title: z.string(), theme: z.string().optional(),
  chapters: z.array(LLMChapterSchema).default([]),
});
const LLMOutlineSchema = z.object({
  title: z.string().optional(), genre: z.string().optional(), overview: z.string().optional(),
  premise: z.string(), mainArc: z.string(), mysteryBox: z.string(), endingDirection: z.string(),
  volumes: z.array(LLMVolumeSchema),
});

export interface StoryOutline {
  premise: string; mainArc: string; mysteryBox: string; endingDirection: string;
  volumes: { sortOrder: number; title: string; summary: string; chapters: { order: number; title: string; summary: string; coreEvent: string; hook: string; characters: string[]; conflictLevel: number; revealLevel: number }[] }[];
}

/** Generate outline and save as preview (structuredOutline). Does NOT modify chapters/volumes. */
export async function generateOutline(novelId: string): Promise<{ outline: StoryOutline; validation: ValidationReport }> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  const context = [
    `书名：《${novel.title}》`, novel.genre ? `题材：${novel.genre}` : null,
    novel.description ? `概述：${novel.description}` : null,
    novel.targetAudience ? `读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `卖点：${novel.bookSellingPoint}` : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    "你是资深小说作者+剧情策划编辑。你的任务不是润色用户想法，而是将其重构为具备持续叙事能力的「故事引擎原型」。输出将作为后续创作的硬约束，必须稳定、明确、可执行。",
    "",
    "核心原则：",
    "1. 优先做冲突重构和叙事驱动构建，不要把重点放在设定说明。",
    "2. 所有字段都服务于「这本书为什么能一直写下去」。",
    "3. 冲突引擎必须回答：剧情为何能不断升级、变形、反转、继续推进。",
    "4. 进度循环必须体现：发现→介入→升级→反噬/反转→再发现。",
    "5. 设置一个持续牵引读者的核心悬念，最关键但暂时无法完全知道的事。",
    "6. 设计2-3个具有画面感、冲突性和后续可扩展性的高张力场面种子。",
    "",
    "字段差异化要求（禁止输出相同或高度重复的内容）：",
    "- premise（前提）：主角被困的处境 + 故事根本驱动力。回答「这个故事为什么能开始」。（80-150字）",
    "- mainArc（主线）：贯穿全书的核心剧情线，从起点到终点的变化弧线。回答「这个故事到底讲什么」。（80-150字）",
    "  premise 和 mainArc 必须有本质区别：premise 是初始困局与起点，mainArc 是全程路径与演变方向。",
    "- mysteryBox（核心悬念）：最关键但暂时无法完全揭晓的未知，持续牵引读者追读。回答「读者为什么想知道后面发生了什么」。（50-100字）",
    "  mysteryBox 必须独立存在，可以是谜题、身份、命运、世界观真相或关系走向，不能只是 premise 或 mainArc 的复述。",
    "- endingDirection（结局方向）：结局气质与情感落点，不是具体细纲而是「这本书最终给人什么感觉」。回答「这个故事最终将走向何种结局」。（50-100字）",
    "- overview（概览）：一句话总览，概括全书面貌。",
    "",
    "题材适配：",
    "悬疑/推理→信息揭示节奏、认知误导、真相分层推进。",
    "成长→阶段性认知变化、代价、认知纠偏与自我重构。",
    "奇幻/科幻→世界观规则必须一致，设定不能随意添加。",
    "",
    "缺失处理：信息不足时不要假装完整，给出最稳妥克制的结果。即使信息不足，所有字段也必须填写，不得留空。",
    "",
    "2-4卷，每卷5-8章，章节标题<=8字。",
  ].join("\n");

  const enhancedPrompt = injectSkillRules(systemPrompt, ["suspense_levels","suspense_strategy","fatal_flaw","plot_structures"]);
  const raw = await aiInvoke({
    task: "planner", systemPrompt: enhancedPrompt,
    userPrompt: `为以下小说生成完整大纲：\n\n${context}`,
    schema: LLMOutlineSchema, temperature: 0.8,
  });

  const outline: StoryOutline = {
    premise: raw.premise ?? raw.overview ?? novel.description ?? "",
    mainArc: raw.mainArc ?? "",
    mysteryBox: raw.mysteryBox ?? "",
    endingDirection: raw.endingDirection ?? "",
    volumes: raw.volumes.map((vol, vi) => ({
      sortOrder: vol.volume ?? vi + 1, title: vol.title, summary: vol.theme ?? "",
      chapters: vol.chapters.map((ch, ci) => ({
        order: ch.chapter ?? ci + 1, title: ch.title, summary: ch.summary ?? ch.coreEvent ?? "",
        coreEvent: ch.coreEvent ?? "", hook: ch.hook ?? "", characters: ch.characters ?? [],
        conflictLevel: 5, revealLevel: 5,
      })),
    })),
  };

  // Validate outline structural integrity
  const validation = validateOutline(outline);

  await prisma.novel.update({
    where: { id: novelId },
    data: {
      structuredOutline: JSON.stringify(outline),
      outline: formatOutline(outline),
      outlineStatus: validation.passed ? "completed" : "completed",
      storylineStatus: "completed",
      estimatedChapterCount: outline.volumes.reduce((s, v) => s + v.chapters.length, 0),
      // Store validation report on the novel for UI display
      ...({} as Record<string, unknown>),
    },
  });

  return { outline, validation };
}

/** Apply the previewed outline: clear old chapters/volumes and recreate from structuredOutline. */
export async function applyOutline(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel?.structuredOutline) throw new Error("No outline to apply");

  const outline: StoryOutline = JSON.parse(novel.structuredOutline);

  // 1.1: Transaction-protected delete + recreate — rollback on any failure
  await prisma.$transaction(async (tx) => {
    await tx.volumeChapterPlan.deleteMany({ where: { volume: { novelId } } });
    await tx.volume.deleteMany({ where: { novelId } });
    await tx.chapter.deleteMany({ where: { novelId } });

    let globalOrder = 0;
    for (const vol of outline.volumes) {
      const volume = await tx.volume.create({
        data: { novelId, sortOrder: vol.sortOrder, title: vol.title, summary: vol.summary },
      });
      for (const ch of vol.chapters) {
        globalOrder++;
        const chapter = await tx.chapter.create({
          data: { novelId, order: globalOrder, title: ch.title, expectation: ch.coreEvent, hook: ch.hook, chapterStatus: "planned" },
        });
        await tx.volumeChapterPlan.create({
          data: { id: `${volume.id}-${chapter.id}`, volumeId: volume.id, chapterId: chapter.id, chapterOrder: globalOrder, title: ch.title, summary: ch.summary },
        });
      }
    }
  });

  // Generate beat sheets (outside transaction — uses LLM)
  for (const vol of outline.volumes) {
    await generateBeatSheet(novelId, vol.sortOrder);
  }
}

function formatOutline(o: StoryOutline): string {
  let t = `# 大纲\n\n**前提**: ${o.premise}\n\n`;
  for (const v of o.volumes) { t += `## ${v.title}\n${v.summary}\n\n`; for (const c of v.chapters) t += `### 第${c.order}章 ${c.title}\n- 事件: ${c.coreEvent}\n- 悬念: ${c.hook}\n\n`; }
  return t;
}
