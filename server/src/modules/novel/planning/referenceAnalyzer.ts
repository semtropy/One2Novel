/**
 * Reference Analyzer — deep module for reference book analysis.
 *
 * Interface: one method per analysis responsibility, each with a small
 * parameter set. The implementation absorbs chapter splitting, AI invocation,
 * JSON parsing, Prisma queries, and profile synchronization.
 *
 * Before: referenceBookService.ts (1044 lines) was a god object with
 *   10+ responsibilities in one factory function.
 * After:  one deep module per analysis domain. Tests exercise the
 *   interface, not the implementation details.
 */

import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import { REF_CHUNK_SIZE, REF_PROMPT_SLICE_LARGE } from "../../../platform/config/constants";
import type { ContentBeatAnnotation } from "@one2novel/shared/types/novel";

// ─── Types ─────────────────────────────────────────────

export interface ChapterSegment {
  title: string;
  content: string;
  charStart: number;
  charEnd: number;
}

export interface ChapterPreview {
  index: number;
  title: string;
  charStart: number;
  charEnd: number;
  estimatedWords: number;
}

export interface ReferenceAnnotation {
  loopBoundaries: Array<{ chapterIndex: number; type: "start" | "end"; loopIndex?: number }>;
  highCoolChapters: number[];
  lowCoolChapters: number[];
  keySettings: Array<{ chapterIndex: number; settingName: string; description: string }>;
}

export interface ReferenceStatistics {
  totalChapters: number;
  totalLoops: number;
  avgChaptersPerLoop: number | null;
  loopDistribution: Array<{ loopIndex: number; startChapter: number; endChapter: number; chapterCount: number }>;
  coolPointDensity: Array<{ chapterIndex: number; level: "high" | "low" | "neutral" }>;
  settingTimeline: Array<{ chapterIndex: number; settingName: string }>;
}

export interface WritingTechnique {
  category: string;
  observation: string;
  rule: string;
  confidence: number;
}

export interface WritingAssetCollection {
  extractedAt: string;
  sourceChapterIndices: number[];
  overallStyleDescription: string;
  narrativeAssets: WritingTechnique[];
  languageAssets: WritingTechnique[];
  characterAssets: WritingTechnique[];
  rhythmAssets: WritingTechnique[];
  antiAiAssets: WritingTechnique[];
}

export interface GoldenFingerBounds {
  abilities: string[];
  limits: string[];
}

export interface ArchitectureDetection {
  type: string;
  confidence: number;
  reasoning: string;
  observedPatterns: string[];
}

export interface HookPatternResult {
  distribution: Record<string, number>;
  avgHookStrength: number;
  typicalHookStyle: string;
}

// ─── Internal helpers ──────────────────────────────────

const CHAPTER_HEADING_RE = /(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+|Ch\.\s*\d+|^\d+[\.\、\s])/gim;

function splitChapters(text: string): ChapterSegment[] {
  const matches: Array<{ index: number; title: string }> = [];
  const regex = new RegExp(CHAPTER_HEADING_RE.source, "gim");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ index: match.index, title: match[0].trim() });
  }

  if (matches.length === 0) {
    const chunks: ChapterSegment[] = [];
    const chunkSize = 15000;
    for (let i = 0; i < text.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, text.length);
      chunks.push({
        title: `第${i / chunkSize + 1}段`,
        content: text.slice(i, end),
        charStart: i,
        charEnd: end,
      });
    }
    return chunks;
  }

  const chapters: ChapterSegment[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
    chapters.push({
      title: matches[i].title,
      content: text.slice(start, end).trim(),
      charStart: start,
      charEnd: end,
    });
  }
  return chapters;
}

async function getChaptersFromDB(novelId: string): Promise<ChapterSegment[]> {
  const prisma = getPrisma();
  try {
    const rows = await (prisma as any).referenceChapter.findMany({
      where: { novelId },
      orderBy: { index: "asc" },
    });
    if (rows.length > 0) {
      return rows.map((r: { title: string; content: string | null; charStart: number; charEnd: number }) => ({
        title: r.title,
        content: r.content ?? "",
        charStart: r.charStart,
        charEnd: r.charEnd,
      }));
    }
  } catch { /* referenceChapter table may not exist in SQLite */ }

  // Fallback: read raw content and split
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (rb?.content) {
    return splitChapters(rb.content);
  }
  return [];
}

async function getAnnotations(novelId: string): Promise<ReferenceAnnotation | null> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (!rb?.annotations) return null;
  try { return JSON.parse(rb.annotations) as ReferenceAnnotation; } catch { return null; }
}

async function saveAnnotations(novelId: string, annotations: ReferenceAnnotation): Promise<void> {
  const prisma = getPrisma();
  await prisma.referenceBook.update({
    where: { novelId },
    data: { annotations: JSON.stringify(annotations) },
  });
}

function uniformSample(total: number, count: number): number[] {
  if (total <= count) return Array.from({ length: total }, (_, i) => i + 1);
  const indices: number[] = [1];
  const step = (total - 1) / (count - 1);
  for (let i = 1; i < count - 1; i++) indices.push(Math.round(1 + i * step));
  indices.push(total);
  return [...new Set(indices)].sort((a, b) => a - b);
}

// ─── 1. Loop Inference ─────────────────────────────────

const LoopInferenceSchema = z.object({
  loopBoundaries: z.array(z.object({
    chapterIndex: z.number().int(),
    type: z.enum(["start", "end"]),
  })),
});

export async function inferLoops(novelId: string): Promise<ReferenceAnnotation> {
  const prisma = getPrisma();
  const chapters = await getChaptersFromDB(novelId);
  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };

  const titleList = chapters.map((ch, i) => `[${i + 1}] ${ch.title.slice(0, 40)}`).join("\n");
  const existingContext = existing?.loopBoundaries?.length
    ? `\n\n用户已标注的回环边界：${existing.loopBoundaries.map(b => `[${b.chapterIndex}]${b.type === "start" ? "起点" : "终点"}`).join("、")}\n请基于这些标注推断其余章节的回环边界。`
    : "";

  const boundaryResult = await aiInvoke({
    assetId: "reference.loop.infer",
    novelId,
    userPrompt: [
      `全书共${chapters.length}章。以下是全部章节目录，请从头到尾扫描，标注每轮回环的起止章号。`,
      `\n${titleList.slice(0, REF_PROMPT_SLICE_LARGE)}${existingContext}`,
      `\n\n请输出每轮回环的起止章号（chapterIndex + type: \"start\"/\"end\"）.`,
      `标题不足以判断时，根据标题的内容暗示（如"突破"/"决战"/"新篇章"等）推断。`,
    ].join("\n"),
    schema: LoopInferenceSchema,
    temperature: 0.3,
  });

  // Phase 2: verify around boundaries
  const boundaries = [...(existing?.loopBoundaries ?? []), ...boundaryResult.loopBoundaries];
  if (boundaries.length > 0) {
    const verifyIndices = new Set<number>();
    for (const b of boundaries) {
      verifyIndices.add(b.chapterIndex);
      if (b.chapterIndex > 1) verifyIndices.add(b.chapterIndex - 1);
      if (b.chapterIndex < chapters.length) verifyIndices.add(b.chapterIndex + 1);
    }
    const verifyChapters = [...verifyIndices]
      .filter(i => i >= 1 && i <= chapters.length)
      .sort((a, b) => a - b)
      .slice(0, 40);

    const verifyText = verifyChapters.map(i => {
      const ch = chapters[i - 1];
      return `[${i}] ${ch.title.slice(0, 40)}\n${ch.content.slice(0, 400).replace(/\n/g, " ")}`;
    }).join("\n\n");

    try {
      const refined = await aiInvoke({
        assetId: "reference.loop.infer",
        novelId,
        userPrompt: [
          `根据以下边界附近章节的正文，修正回环边界位置。`,
          `当前推断的边界：${boundaries.map(b => `[${b.chapterIndex}]${b.type}`).join("、")}`,
          `\n边界附近章节正文：\n${verifyText.slice(0, 12000)}`,
        ].join("\n"),
        schema: LoopInferenceSchema,
        temperature: 0.3,
      });
      const userBoundaries = existing?.loopBoundaries ?? [];
      const userIndices = new Set(userBoundaries.map(b => b.chapterIndex));
      const merged: ReferenceAnnotation = {
        loopBoundaries: [...userBoundaries, ...refined.loopBoundaries.filter(b => !userIndices.has(b.chapterIndex))],
        highCoolChapters: existing?.highCoolChapters ?? [],
        lowCoolChapters: existing?.lowCoolChapters ?? [],
        keySettings: existing?.keySettings ?? [],
      };
      await saveAnnotations(novelId, merged);
      return merged;
    } catch { /* best-effort */ }
  }

  const userBoundaries = existing?.loopBoundaries ?? [];
  const userIndices = new Set(userBoundaries.map(b => b.chapterIndex));
  const merged: ReferenceAnnotation = {
    loopBoundaries: [...userBoundaries, ...boundaryResult.loopBoundaries.filter(b => !userIndices.has(b.chapterIndex))],
    highCoolChapters: existing?.highCoolChapters ?? [],
    lowCoolChapters: existing?.lowCoolChapters ?? [],
    keySettings: existing?.keySettings ?? [],
  };
  await saveAnnotations(novelId, merged);
  return merged;
}

// ─── 2. Cool Point Inference ───────────────────────────

const CoolPointInferenceSchema = z.object({
  highCoolChapters: z.array(z.number().int()),
  lowCoolChapters: z.array(z.number().int()),
});

export async function inferCoolPoints(novelId: string): Promise<ReferenceAnnotation> {
  const chapters = await getChaptersFromDB(novelId);
  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const sampleIndices = uniformSample(chapters.length, 60);

  const chapterSnippets = sampleIndices.map(i => {
    const ch = chapters[i - 1];
    return `[${i}] ${ch.title.slice(0, 40)} — ${ch.content.slice(0, 300).replace(/\n/g, " ")}`;
  }).join("\n\n");

  const existingContext = [
    existing?.highCoolChapters?.length ? `已标注高爽点：${existing.highCoolChapters.join("、")}章` : "",
    existing?.lowCoolChapters?.length ? `已标注低爽点：${existing.lowCoolChapters.join("、")}章` : "",
  ].filter(Boolean).join("\n");

  const raw = await aiInvoke({
    assetId: "reference.coolpoint.infer",
    novelId,
    userPrompt: `参考书章节片段(均匀采样${sampleIndices.length}章覆盖全书${chapters.length}章)：\n${chapterSnippets.slice(0, REF_PROMPT_SLICE_LARGE)}\n\n${existingContext}`,
    schema: CoolPointInferenceSchema,
    temperature: 0.4,
  });

  const merged: ReferenceAnnotation = {
    loopBoundaries: existing?.loopBoundaries ?? [],
    highCoolChapters: [...new Set([...(existing?.highCoolChapters ?? []), ...raw.highCoolChapters])],
    lowCoolChapters: [...new Set([...(existing?.lowCoolChapters ?? []), ...raw.lowCoolChapters])],
    keySettings: existing?.keySettings ?? [],
  };
  await saveAnnotations(novelId, merged);
  return merged;
}

// ─── 3. Architecture Detection ─────────────────────────

export async function detectArchitecture(novelId: string): Promise<ArchitectureDetection> {
  const prisma = getPrisma();
  const chapters = await getChaptersFromDB(novelId);
  const total = chapters.length;
  const indices = [1, 2, 3, Math.floor(total / 3), Math.floor(total * 2 / 3), total - 1, total]
    .filter(i => i >= 1 && i <= total);
  const sample = [...new Set(indices)].sort((a, b) => a - b).map(i => {
    const ch = chapters[i - 1];
    return `第${i}章 ${ch.title.slice(0, 40)}\n${ch.content.slice(0, 500).replace(/\n/g, " ")}`;
  }).join("\n\n---\n\n");

  const ArchitectureDetectSchema = z.object({
    architectureType: z.enum(["skill_slot", "sequence_promotion", "case_driven", "cultivation_planning", "hexagon_godhood", "historical_transmigration"]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    observedPatterns: z.array(z.string()),
  });

  const raw = await aiInvoke({
    assetId: "reference.architecture.detect",
    novelId,
    userPrompt: [
      "根据以下小说章节片段，判断它属于以下哪种网文架构类型：",
      "1. skill_slot（技能栏搭配）", "2. sequence_promotion（序列晋升）",
      "3. case_driven（超凡办案）", "4. cultivation_planning（修真规划）",
      "5. hexagon_godhood（六边形成神）", "6. historical_transmigration（穿越历史）",
      "", "章节采样：", sample.slice(0, 12000),
    ].join("\n"),
    schema: ArchitectureDetectSchema,
    temperature: 0.3,
  });

  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const detected: ArchitectureDetection = {
    type: raw.architectureType,
    confidence: raw.confidence,
    reasoning: raw.reasoning,
    observedPatterns: raw.observedPatterns,
  };
  const merged = { ...existing, detectedArchitecture: detected };
  await saveAnnotations(novelId, merged as ReferenceAnnotation);
  return detected;
}

// ─── 4. Hook Pattern Extraction ────────────────────────

export async function extractHookPatterns(novelId: string): Promise<HookPatternResult> {
  const chapters = await getChaptersFromDB(novelId);
  const total = chapters.length;
  const step = Math.max(1, Math.floor(total / 15));
  const samples: string[] = [];
  for (let i = 1; i <= total && samples.length < 15; i += step) {
    const ch = chapters[i - 1];
    samples.push(`第${i}章结尾：${ch.content.slice(-300).replace(/\n/g, " ")}`);
  }

  const HookPatternSchema = z.object({
    hookDistribution: z.object({
      suspense: z.number(), reversal: z.number(), preview: z.number(), emotional: z.number(),
    }),
    avgHookStrength: z.number().min(0).max(1),
    typicalHookStyle: z.string(),
  });

  const raw = await aiInvoke({
    assetId: "reference.hook.extract",
    novelId,
    userPrompt: [
      "分析以下15个章节结尾的钩子风格，分类为：suspense/reversal/preview/emotional",
      "", "章节结尾采样：", samples.join("\n\n").slice(0, 8000),
    ].join("\n"),
    schema: HookPatternSchema,
    temperature: 0.3,
  });

  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const result: HookPatternResult = {
    distribution: raw.hookDistribution,
    avgHookStrength: raw.avgHookStrength,
    typicalHookStyle: raw.typicalHookStyle,
  };
  const merged = { ...existing, hookPatterns: result };
  await saveAnnotations(novelId, merged as ReferenceAnnotation);
  return result;
}

// ─── 5. Golden Finger Extraction ───────────────────────

export async function extractGoldenFingerBounds(novelId: string): Promise<GoldenFingerBounds> {
  const chapters = await getChaptersFromDB(novelId);
  const total = chapters.length;
  const sampleIndices = [1, 2, 3, 5, 10, Math.floor(total / 4), Math.floor(total / 2)]
    .filter(i => i >= 1 && i <= total);
  const sample = [...new Set(sampleIndices)].sort((a, b) => a - b).map(i => {
    const ch = chapters[i - 1];
    return `第${i}章 ${ch.title.slice(0, 30)}\n${ch.content.slice(0, 600).replace(/\n/g, " ")}`;
  }).join("\n\n---\n\n");

  const GoldenFingerSchema = z.object({
    abilities: z.array(z.string()),
    limits: z.array(z.string()),
    goldenFingerName: z.string(),
    acquisitionChapter: z.number().int().optional(),
  });

  const raw = await aiInvoke({
    assetId: "reference.golden-finger.extract",
    novelId,
    userPrompt: [
      "从以下小说章节中提取主角的金手指信息（能力、限制、名称）。",
      "", "章节采样：", sample.slice(0, 12000),
    ].join("\n"),
    schema: GoldenFingerSchema,
    temperature: 0.3,
  });

  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const bounds: GoldenFingerBounds = { abilities: raw.abilities, limits: raw.limits };
  const merged = { ...existing, goldenFingerBounds: { ...bounds, name: raw.goldenFingerName } };
  await saveAnnotations(novelId, merged as ReferenceAnnotation);
  return bounds;
}

// ─── 6. Setting Timeline Extraction ────────────────────

export async function extractSettingTimeline(novelId: string): Promise<Array<{ chapterIndex: number; settingName: string; description: string }>> {
  const chapters = await getChaptersFromDB(novelId);
  const earlyIndices = Array.from({ length: Math.min(10, chapters.length) }, (_, i) => i + 1);
  const laterIndices = uniformSample(Math.max(0, chapters.length - 10), 40).map(i => i + 10).filter(i => i <= chapters.length);
  const sampleIndices = [...new Set([...earlyIndices, ...laterIndices])].sort((a, b) => a - b);
  const sample = sampleIndices.map(i => {
    const ch = chapters[i - 1];
    return `第${i}章 ${ch.title.slice(0, 30)}\n${ch.content.slice(0, 300).replace(/\n/g, " ")}`;
  }).join("\n\n---\n\n");

  const SettingTimelineSchema = z.object({
    settings: z.array(z.object({
      chapterIndex: z.number().int(),
      settingName: z.string(),
      description: z.string().max(200),
      category: z.enum(["力量规则", "世界历史", "角色秘密", "势力格局", "地理环境", "其他"]),
    })),
  });

  const raw = await aiInvoke({
    assetId: "reference.setting-timeline.extract",
    novelId,
    userPrompt: [
      "分析以下小说章节，提取关键世界观设定的首次揭示节点。",
      "", "章节列表：", sample.slice(0, 12000),
    ].join("\n"),
    schema: SettingTimelineSchema,
    temperature: 0.3,
  });

  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const merged = { ...existing, keySettings: raw.settings };
  await saveAnnotations(novelId, merged as ReferenceAnnotation);
  return raw.settings;
}

// ─── 7. Content Beat Extraction ────────────────────────

const ContentBeatExtractionSchema = z.object({
  loopPatterns: z.array(z.object({
    loopIndex: z.number().int(),
    startChapter: z.number().int(),
    endChapter: z.number().int(),
    beats: z.record(z.string(), z.number()),
  })),
  overallDistribution: z.record(z.string(), z.number()),
  beatTypes: z.array(z.string()),
});

export async function extractContentBeats(novelId: string): Promise<ContentBeatAnnotation> {
  const chapters = await getChaptersFromDB(novelId);
  const annotations = await getAnnotations(novelId);
  const loopBoundaries = annotations?.loopBoundaries ?? [];

  const starts = loopBoundaries.filter(b => b.type === "start").sort((a, b) => a.chapterIndex - b.chapterIndex);
  const ends = loopBoundaries.filter(b => b.type === "end").sort((a, b) => a.chapterIndex - b.chapterIndex);
  const loops = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    loops.push({ loopIndex: i + 1, startChapter: starts[i].chapterIndex, endChapter: ends[i].chapterIndex });
  }
  if (loops.length === 0) loops.push({ loopIndex: 1, startChapter: 1, endChapter: chapters.length });

  const samples: string[] = [];
  for (const loop of loops) {
    const chapterCount = loop.endChapter - loop.startChapter + 1;
    const sampleCount = Math.min(3, chapterCount);
    const step = Math.max(1, Math.floor(chapterCount / (sampleCount + 1)));
    for (let j = 1; j <= sampleCount; j++) {
      const idx = loop.startChapter + step * j - 1;
      if (idx >= 1 && idx <= chapters.length) {
        const ch = chapters[idx - 1];
        samples.push(`[回环${loop.loopIndex}·第${idx}章] ${ch.title}\n${ch.content.slice(0, 500).replace(/\n/g, " ")}`);
      }
    }
  }

  const raw = await aiInvoke({
    assetId: "reference.content-beats.extract",
    novelId,
    userPrompt: [
      `全书共${chapters.length}章，${loops.length}轮回环。以下是从每轮回环均匀采样的章节片段：`,
      samples.join("\n\n---\n\n").slice(0, 18000),
      `\n\n请分析每轮回环的内容节拍分布。`,
    ].join("\n"),
    schema: ContentBeatExtractionSchema,
    temperature: 0.4,
  });

  const annotation: ContentBeatAnnotation = {
    extractedAt: new Date().toISOString(),
    beatTypes: raw.beatTypes,
    overallDistribution: raw.overallDistribution,
    loopPatterns: raw.loopPatterns,
    totalChapters: chapters.length,
  };

  const existing = (await getAnnotations(novelId)) ?? { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };
  const merged = { ...existing, contentBeatPatterns: annotation };
  await saveAnnotations(novelId, merged as ReferenceAnnotation);
  return annotation;
}

// ─── 8. Writing Assets Extraction ──────────────────────

export async function extractWritingAssets(novelId: string): Promise<WritingAssetCollection> {
  const chapters = await getChaptersFromDB(novelId);
  const annotations = await getAnnotations(novelId);

  const sampleIndices = new Set<number>();
  sampleIndices.add(1); sampleIndices.add(2);
  if (annotations?.loopBoundaries) {
    for (const b of annotations.loopBoundaries) {
      sampleIndices.add(b.chapterIndex);
      sampleIndices.add(Math.min(b.chapterIndex + 1, chapters.length));
    }
  }
  if (annotations?.highCoolChapters) {
    for (const ci of annotations.highCoolChapters.slice(0, 3)) sampleIndices.add(ci);
  }
  sampleIndices.add(chapters.length - 1);
  sampleIndices.add(chapters.length);

  const sampled = [...sampleIndices]
    .filter(i => i >= 1 && i <= chapters.length)
    .sort((a, b) => a - b)
    .slice(0, 10)
    .map(i => {
      const ch = chapters[i - 1];
      return `\n--- 第${i}章 ${ch.title} ---\n${ch.content.slice(0, 2000)}`;
    }).join("\n");

  const WritingTechniqueSchema = z.object({
    category: z.string(), observation: z.string().max(300), rule: z.string().max(300), confidence: z.number().min(0).max(1),
  });
  const WritingAssetExtractionSchema = z.object({
    overallStyleDescription: z.string().max(300),
    narrativeAssets: z.array(WritingTechniqueSchema).max(5),
    languageAssets: z.array(WritingTechniqueSchema).max(5),
    characterAssets: z.array(WritingTechniqueSchema).max(5),
    rhythmAssets: z.array(WritingTechniqueSchema).max(5),
    antiAiAssets: z.array(WritingTechniqueSchema).max(5),
  });

  const raw = await aiInvoke({
    assetId: "reference.writing_assets.extract",
    novelId,
    userPrompt: `分析以下对标网络小说的写作技法，从五个维度提取可模仿的写法规则。\n\n对标书章节采样：\n${sampled.slice(0, 18000)}`,
    schema: WritingAssetExtractionSchema,
    temperature: 0.4,
  });

  const assets: WritingAssetCollection = {
    extractedAt: new Date().toISOString(),
    sourceChapterIndices: [...sampleIndices].filter(i => i >= 1 && i <= chapters.length).slice(0, 10),
    overallStyleDescription: raw.overallStyleDescription,
    narrativeAssets: raw.narrativeAssets,
    languageAssets: raw.languageAssets,
    characterAssets: raw.characterAssets,
    rhythmAssets: raw.rhythmAssets,
    antiAiAssets: raw.antiAiAssets,
  };

  // Persist to profile
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (rb?.profileId) {
    // Sync to profile (columns may not exist in all schemas)
    try { await prisma.$executeRaw`UPDATE "ReferenceProfile" SET "writingAssets" = ${JSON.stringify(assets)}, "totalChapters" = ${chapters.length} WHERE "id" = ${rb.profileId}`; } catch { /* columns may not exist */ }
  }
  try {
    await prisma.referenceBook.update({ where: { novelId }, data: { writingAssets: JSON.stringify(assets) } });
  } catch { /* column may not exist */ }
  return assets;
}

// ─── 9. Statistics ─────────────────────────────────────

export async function getStatistics(novelId: string): Promise<ReferenceStatistics> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (!rb) throw new Error("No reference book");

  const annotations: ReferenceAnnotation = rb.annotations
    ? (() => { try { return JSON.parse(rb.annotations) as ReferenceAnnotation; } catch { return { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] }; } })()
    : { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };

  const starts = annotations.loopBoundaries.filter(b => b.type === "start").sort((a, b) => a.chapterIndex - b.chapterIndex);
  const ends = annotations.loopBoundaries.filter(b => b.type === "end").sort((a, b) => a.chapterIndex - b.chapterIndex);

  const loopDistribution: ReferenceStatistics["loopDistribution"] = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    loopDistribution.push({
      loopIndex: i + 1, startChapter: starts[i].chapterIndex,
      endChapter: ends[i].chapterIndex,
      chapterCount: ends[i].chapterIndex - starts[i].chapterIndex + 1,
    });
  }

  const highSet = new Set(annotations.highCoolChapters ?? []);
  const lowSet = new Set(annotations.lowCoolChapters ?? []);
  const coolPointDensity: ReferenceStatistics["coolPointDensity"] = [];
  const maxChapter = rb.totalChapters ?? Math.max(
    ...annotations.loopBoundaries.map(b => b.chapterIndex),
    ...(annotations.highCoolChapters ?? []),
    ...(annotations.lowCoolChapters ?? []),
    1
  );
  for (let i = 1; i <= maxChapter; i++) {
    coolPointDensity.push({ chapterIndex: i, level: highSet.has(i) ? "high" : lowSet.has(i) ? "low" : "neutral" });
  }

  const settingTimeline = (annotations.keySettings ?? [])
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map(s => ({ chapterIndex: s.chapterIndex, settingName: s.settingName }));

  return {
    totalChapters: rb.totalChapters ?? 0,
    totalLoops: loopDistribution.length,
    avgChaptersPerLoop: loopDistribution.length > 0
      ? Math.round(loopDistribution.reduce((s, l) => s + l.chapterCount, 0) / loopDistribution.length)
      : null,
    loopDistribution, coolPointDensity, settingTimeline,
  };
}
