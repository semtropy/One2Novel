/**
 * Reference Book Service — upload, split, annotate, and analyze reference novels.
 * Phase 4: Chapter splitting + guided annotation + LLM-assisted inference + statistics.
 */
import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import type { ContentBeatAnnotation } from "@one2novel/shared/types/novel";

// ─── Types ─────────────────────────────────────────────

export interface ReferenceBookData {
  id: string;
  novelId: string;
  fileName: string;
  totalChapters: number | null;
  content: string | null;
  chapters: ChapterPreview[];
  annotations: ReferenceAnnotation | null;
  analysisSummary: unknown | null;
  createdAt: string;
  updatedAt: string;
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

// ─── Writing Asset Types ─────────────────────────────

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

export interface ReferenceBookService {
  upload(novelId: string, fileName: string, content: string): Promise<ReferenceBookData>;
  get(novelId: string): Promise<ReferenceBookData | null>;
  remove(novelId: string): Promise<void>;
  getChapters(novelId: string): Promise<ChapterPreview[]>;
  getChapterContent(novelId: string, chapterIndex: number): Promise<string | null>;
  saveAnnotations(novelId: string, annotations: ReferenceAnnotation): Promise<ReferenceBookData>;
  saveAnalysis(novelId: string, summary: unknown): Promise<ReferenceBookData>;
  inferLoops(novelId: string): Promise<ReferenceAnnotation>;
  inferCoolPoints(novelId: string): Promise<ReferenceAnnotation>;
  getStatistics(novelId: string): Promise<ReferenceStatistics>;
  extractWritingAssets(novelId: string): Promise<WritingAssetCollection>;
  createStyleProfileFromAssets(novelId: string): Promise<{ profileId: string; bindingId: string }>;
  detectArchitecture(novelId: string): Promise<{ type: string; confidence: number; reasoning: string; observedPatterns: string[] }>;
  extractHookPatterns(novelId: string): Promise<{ distribution: Record<string, number>; avgHookStrength: number; typicalHookStyle: string }>;
  extractGoldenFingerBounds(novelId: string): Promise<{ abilities: string[]; limits: string[] }>;
  extractSettingTimeline(novelId: string): Promise<Array<{ chapterIndex: number; settingName: string; description: string }>>;
  extractContentBeats(novelId: string): Promise<ContentBeatAnnotation>;
}

// ─── LLM Schemas ───────────────────────────────────────

const LoopInferenceSchema = z.object({
  loopBoundaries: z.array(z.object({
    chapterIndex: z.number().int(),
    type: z.enum(["start", "end"]),
  })),
});

const ContentBeatExtractionSchema = z.object({
  loopPatterns: z.array(z.object({
    loopIndex: z.number().int(),
    startChapter: z.number().int(),
    endChapter: z.number().int(),
    beats: z.record(z.string(), z.number()), // beat type → chapter count
  })),
  overallDistribution: z.record(z.string(), z.number()),
  beatTypes: z.array(z.string()),
});

const CoolPointInferenceSchema = z.object({
  highCoolChapters: z.array(z.number().int()),
  lowCoolChapters: z.array(z.number().int()),
});

// ─── Chapter Splitting ─────────────────────────────────

const CHAPTER_HEADING_RE = /(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+|Ch\.\s*\d+|^\d+[\.\、\s])/gim;

function countChapters(text: string): number {
  const matches = text.match(CHAPTER_HEADING_RE);
  return matches ? matches.length : Math.ceil(text.length / 10000);
}

/** Uniformly sample N indices from [1, totalChapters], always including first and last. */
function uniformSample(totalChapters: number, sampleCount: number): number[] {
  if (totalChapters <= sampleCount) {
    return Array.from({ length: totalChapters }, (_, i) => i + 1);
  }
  const indices: number[] = [1];
  const step = (totalChapters - 1) / (sampleCount - 1);
  for (let i = 1; i < sampleCount - 1; i++) {
    indices.push(Math.round(1 + i * step));
  }
  indices.push(totalChapters);
  return [...new Set(indices)].sort((a, b) => a - b);
}

function splitChapters(text: string): { title: string; content: string; charStart: number; charEnd: number }[] {
  const matches: Array<{ index: number; title: string }> = [];
  const regex = new RegExp(CHAPTER_HEADING_RE.source, "gim");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ index: match.index, title: match[0].trim() });
  }

  if (matches.length === 0) {
    // No chapter headings found — treat entire text as one chapter, or split by size
    const chunkSize = 15000; // ~15K chars per chunk
    const chunks: { title: string; content: string; charStart: number; charEnd: number }[] = [];
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

  const chapters: { title: string; content: string; charStart: number; charEnd: number }[] = [];
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

// ─── Service Factory ────────────────────────────────────

export function createReferenceBookService(): ReferenceBookService {
  return {
    async upload(novelId, fileName, content) {
      const prisma = getPrisma();
      const chapters = splitChapters(content);
      const totalChapters = chapters.length;
      const rb = await prisma.referenceBook.upsert({
        where: { novelId },
        create: {
          novelId, fileName, content, totalChapters,
          annotations: JSON.stringify({
            loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [],
          }),
        },
        update: { fileName, content, totalChapters },
      });

      const chapterPreviews: ChapterPreview[] = chapters.map((ch, i) => ({
        index: i + 1,
        title: ch.title,
        charStart: ch.charStart,
        charEnd: ch.charEnd,
        estimatedWords: ch.content.length,
      }));

      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters,
        content: content.slice(0, 5000),
        chapters: chapterPreviews,
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(),
        updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async get(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb) return null;
      const chapters = rb.content ? splitChapters(rb.content) : [];
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: rb.content,
        chapters: chapters.map((ch, i) => ({
          index: i + 1, title: ch.title,
          charStart: ch.charStart, charEnd: ch.charEnd,
          estimatedWords: ch.content.length,
        })),
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(),
        updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async remove(novelId) {
      const prisma = getPrisma();
      await prisma.referenceBook.deleteMany({ where: { novelId } });
    },

    async getChapters(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) return [];
      const chapters = splitChapters(rb.content);
      return chapters.map((ch, i) => ({
        index: i + 1, title: ch.title,
        charStart: ch.charStart, charEnd: ch.charEnd,
        estimatedWords: ch.content.length,
      }));
    },

    async getChapterContent(novelId, chapterIndex) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) return null;
      const chapters = splitChapters(rb.content);
      const ch = chapters[chapterIndex - 1];
      return ch ? ch.content.slice(0, 8000) : null; // Return up to 8K chars per chapter
    },

    async saveAnnotations(novelId, annotations) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(annotations) },
      });
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: null, chapters: [],
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async saveAnalysis(novelId, summary) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.update({
        where: { novelId },
        data: { analysisSummary: JSON.stringify(summary) },
      });
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: null, chapters: [],
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async inferLoops(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      const existing = rb.annotations ? JSON.parse(rb.annotations) as ReferenceAnnotation : null;

      // Phase 1: Scan ALL chapter titles (compact, fits in one call) to find loop boundaries
      const titleList = chapters.map((ch, i) =>
        `[${i + 1}] ${ch.title.slice(0, 40)}`
      ).join("\n");

      const existingContext = existing?.loopBoundaries?.length
        ? `\n\n用户已标注的回环边界：${existing.loopBoundaries.map(b => `[${b.chapterIndex}]${b.type === "start" ? "起点" : "终点"}`).join("、")}\n请基于这些标注推断其余章节的回环边界。`
        : "";

      // Phase 1: Title-only scan for boundary detection
      const boundaryResult = await aiInvoke({
        assetId: "reference.loop.infer",
        novelId,
        userPrompt: [
          `全书共${chapters.length}章。以下是全部章节目录，请从头到尾扫描，标注每轮回环的起止章号。`,
          `\n${titleList.slice(0, 15000)}${existingContext}`,
          `\n\n请输出每轮回环的起止章号（chapterIndex + type: \"start\"/\"end\"）。`,
          `标题不足以判断时，根据标题的内容暗示（如\"突破\"/\"决战\"/\"新篇章\"等）推断。`,
        ].join("\n"),
        schema: LoopInferenceSchema,
        temperature: 0.3,
      });

      // Phase 2: Deep-read around detected boundaries to verify
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
          // Merge: user annotations always win, then refined boundaries
          const userBoundaries = existing?.loopBoundaries ?? [];
          const userIndices = new Set(userBoundaries.map(b => b.chapterIndex));
          const mergedBoundaries = [
            ...userBoundaries,
            ...refined.loopBoundaries.filter(b => !userIndices.has(b.chapterIndex)),
          ];
          const merged: ReferenceAnnotation = {
            loopBoundaries: mergedBoundaries,
            highCoolChapters: existing?.highCoolChapters ?? [],
            lowCoolChapters: existing?.lowCoolChapters ?? [],
            keySettings: existing?.keySettings ?? [],
          };
          await prisma.referenceBook.update({
            where: { novelId },
            data: { annotations: JSON.stringify(merged) },
          });
          return merged;
        } catch { /* Phase 2 is best-effort, fall through to Phase 1 result */ }
      }

      // Fallback: use Phase 1 result
      const userBoundaries = existing?.loopBoundaries ?? [];
      const userIndices = new Set(userBoundaries.map(b => b.chapterIndex));
      const merged: ReferenceAnnotation = {
        loopBoundaries: [...userBoundaries, ...boundaryResult.loopBoundaries.filter(b => !userIndices.has(b.chapterIndex))],
        highCoolChapters: existing?.highCoolChapters ?? [],
        lowCoolChapters: existing?.lowCoolChapters ?? [],
        keySettings: existing?.keySettings ?? [],
      };

      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(merged) },
      });

      return merged;
    },

    async inferCoolPoints(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      const existing = rb.annotations ? JSON.parse(rb.annotations) as ReferenceAnnotation : null;

      // Uniformly sample 60 chapters across the entire book
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
        userPrompt: `参考书章节片段(均匀采样${sampleIndices.length}章覆盖全书${chapters.length}章)：\n${chapterSnippets.slice(0, 15000)}\n\n${existingContext}`,
        schema: CoolPointInferenceSchema,
        temperature: 0.4,
      });

      const merged: ReferenceAnnotation = {
        loopBoundaries: existing?.loopBoundaries ?? [],
        highCoolChapters: [...new Set([...(existing?.highCoolChapters ?? []), ...raw.highCoolChapters])],
        lowCoolChapters: [...new Set([...(existing?.lowCoolChapters ?? []), ...raw.lowCoolChapters])],
        keySettings: existing?.keySettings ?? [],
      };

      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(merged) },
      });

      return merged;
    },

    // ─── Architecture Detection ──────────────────────

    async detectArchitecture(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      // Sample: first 3 chapters + 3 evenly spaced mid chapters + last 2
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
          "",
          "1. skill_slot（技能栏搭配）：力量体系有固定槽位限制，主角有更多槽位或自由选择/合成能力，收集技能→搭配策略→验证战斗",
          "2. sequence_promotion（序列晋升）：力量体系是序列/途径树，晋升需要材料+仪式+扮演，有隐藏职业/序列",
          "3. case_driven（超凡办案）：主角隶属于超凡执法机构，通过办案积累功绩和资源，案件背后有核心阴谋",
          "4. cultivation_planning（修真规划）：传统修真体系，金手指放大资源获取效率，主角在每个境界完美规划/补齐辅修",
          "5. hexagon_godhood（六边形成神）：主角需要在多个维度（武力/精神/势力/财富等）逐一补全短板，从底层爬上神座",
          "6. historical_transmigration（穿越历史）：穿越到特定历史时期，用前世知识+金手指改变历史进程、进行社会实验",
          "",
          "章节采样：",
          sample.slice(0, 12000),
        ].join("\n"),
        schema: ArchitectureDetectSchema,
        temperature: 0.3,
      });

      // Store in annotations
      const existing = rb.annotations ? JSON.parse(rb.annotations) : {};
      existing.detectedArchitecture = {
        type: raw.architectureType,
        confidence: raw.confidence,
        reasoning: raw.reasoning,
        observedPatterns: raw.observedPatterns,
      };
      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(existing) },
      });

      return existing.detectedArchitecture;
    },

    // ─── Hook Pattern Extraction ─────────────────────

    async extractHookPatterns(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      // Sample 15 chapters evenly spaced to get hook distribution
      const total = chapters.length;
      const step = Math.max(1, Math.floor(total / 15));
      const samples: string[] = [];
      for (let i = 1; i <= total && samples.length < 15; i += step) {
        const ch = chapters[i - 1];
        // Get last 300 chars for chapter-end hook analysis
        const ending = ch.content.slice(-300);
        samples.push(`第${i}章结尾：${ending.replace(/\n/g, " ")}`);
      }

      const HookPatternSchema = z.object({
        hookDistribution: z.object({
          suspense: z.number(),  // 悬念型：留下未知信息
          reversal: z.number(),  // 反转型：出乎意料的转折
          preview: z.number(),   // 预告型：下一章的期待
          emotional: z.number(), // 情绪型：情感余韵
        }),
        avgHookStrength: z.number().min(0).max(1),
        typicalHookStyle: z.string(),
      });

      const raw = await aiInvoke({
        assetId: "reference.hook.extract",
        novelId,
        userPrompt: [
          "分析以下15个章节结尾的钩子风格，分类为：",
          "- suspense（悬念型）：留下问题或未知信息，让读者想知道答案",
          "- reversal（反转型）：出乎意料的事件或信息披露",
          "- preview（预告型）：暗示下一章会发生什么",
          "- emotional（情绪型）：以情感余韵收尾",
          "",
          "章节结尾采样：",
          samples.join("\n\n").slice(0, 8000),
        ].join("\n"),
        schema: HookPatternSchema,
        temperature: 0.3,
      });

      // Store in annotations
      const existing = rb.annotations ? JSON.parse(rb.annotations) : {};
      existing.hookPatterns = {
        distribution: raw.hookDistribution,
        avgHookStrength: raw.avgHookStrength,
        typicalHookStyle: raw.typicalHookStyle,
      };
      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(existing) },
      });

      return existing.hookPatterns;
    },

    // ─── Golden Finger Extraction ───────────────────

    async extractGoldenFingerBounds(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      // Sample early chapters (where golden finger is typically introduced) + mid chapters
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
        acquisitionChapter: z.number().int().optional(),
        goldenFingerName: z.string(),
      });

      const raw = await aiInvoke({
        assetId: "reference.golden-finger.extract",
        novelId,
        userPrompt: [
          "从以下小说章节中提取主角的金手指信息。金手指指主角特有的超凡能力/系统/传承等。",
          "",
          "提取要求：",
          "1. abilities：金手指能做什么（逐条列出具体能力）",
          "2. limits：金手指的硬边界（冷却时间/次数限制/代价/副作用/使用条件）",
          "3. goldenFingerName：金手指的名称",
          "4. acquisitionChapter：金手指首次出现/获得的章节号",
          "",
          "章节采样：",
          sample.slice(0, 12000),
        ].join("\n"),
        schema: GoldenFingerSchema,
        temperature: 0.3,
      });

      // Store in annotations
      const existing = rb.annotations ? JSON.parse(rb.annotations) : {};
      existing.goldenFingerBounds = {
        name: raw.goldenFingerName,
        abilities: raw.abilities,
        limits: raw.limits,
        acquisitionChapter: raw.acquisitionChapter,
      };
      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(existing) },
      });

      return { abilities: raw.abilities, limits: raw.limits };
    },

    // ─── Setting Timeline Extraction ────────────────

    async extractSettingTimeline(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      // Sample: first 10 chapters (where most settings debut) + uniform 40 across the rest
      const earlyIndices = Array.from({ length: Math.min(10, chapters.length) }, (_, i) => i + 1);
      const laterIndices = uniformSample(Math.max(0, chapters.length - 10), 40)
        .map(i => i + 10)
        .filter(i => i <= chapters.length);
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
          category: z.enum(["力量体系", "世界历史", "角色秘密", "势力格局", "地理环境", "其他"]),
        })),
      });

      const raw = await aiInvoke({
        assetId: "reference.setting-timeline.extract",
        novelId,
        userPrompt: [
          "分析以下小说章节，提取关键世界观设定的首次揭示节点。",
          "",
          "关注以下类型的设定：",
          "- 力量体系：境界/序列/技能系统的规则首次说明",
          "- 世界历史：重大历史事件或世界起源",
          "- 角色秘密：主要角色的隐藏身份/过去",
          "- 势力格局：组织/国家/种族之间的关系",
          "- 地理环境：重要的地图/区域信息",
          "",
          "章节列表：",
          sample.slice(0, 12000),
        ].join("\n"),
        schema: SettingTimelineSchema,
        temperature: 0.3,
      });

      // Store in annotations
      const existing = rb.annotations ? JSON.parse(rb.annotations) : {};
      existing.keySettings = raw.settings;
      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(existing) },
      });

      return raw.settings;
    },

    // ─── Content Beat Extraction ─────────────────────

    async extractContentBeats(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      const annotations: ReferenceAnnotation | null = rb.annotations ? JSON.parse(rb.annotations) : null;
      const loopBoundaries = annotations?.loopBoundaries ?? [];

      // Build loops from boundaries
      const starts = loopBoundaries.filter(b => b.type === "start").sort((a, b) => a.chapterIndex - b.chapterIndex);
      const ends = loopBoundaries.filter(b => b.type === "end").sort((a, b) => a.chapterIndex - b.chapterIndex);
      const loops = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        loops.push({ loopIndex: i + 1, startChapter: starts[i].chapterIndex, endChapter: ends[i].chapterIndex });
      }
      if (loops.length === 0) {
        // Fallback: treat whole book as one loop
        loops.push({ loopIndex: 1, startChapter: 1, endChapter: chapters.length });
      }

      // Sample 2-3 chapters per loop for content beat classification
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

      // Store in annotations
      const existing = rb.annotations ? JSON.parse(rb.annotations) : {};
      const annotation: ContentBeatAnnotation = {
        extractedAt: new Date().toISOString(),
        beatTypes: raw.beatTypes,
        overallDistribution: raw.overallDistribution,
        loopPatterns: raw.loopPatterns,
        totalChapters: chapters.length,
      };
      existing.contentBeatPatterns = annotation;
      await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(existing) },
      });

      return annotation;
    },

    // ─── Writing Assets Extraction ──────────────────

    async extractWritingAssets(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) throw new Error("No reference book uploaded");

      const chapters = splitChapters(rb.content);
      const annotations: ReferenceAnnotation | null = rb.annotations ? JSON.parse(rb.annotations) : null;

      // Strategic sampling: first 2 + loop boundary chapters + high-cool chapters + last 2
      const sampleIndices = new Set<number>();
      sampleIndices.add(1);
      sampleIndices.add(2);
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
        })
        .join("\n");

      const WritingTechniqueSchema = z.object({
        category: z.string(),
        observation: z.string().max(300),
        rule: z.string().max(300),
        confidence: z.number().min(0).max(1),
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

      await prisma.referenceBook.update({
        where: { novelId },
        data: { writingAssets: JSON.stringify(assets) },
      });

      return assets;
    },

    // ─── Create Style Profile from Writing Assets ─────

    async createStyleProfileFromAssets(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb) throw new Error("No reference book");

      let assets: WritingAssetCollection;
      if (rb.writingAssets) {
        assets = JSON.parse(rb.writingAssets) as WritingAssetCollection;
      } else {
        assets = await this.extractWritingAssets!(novelId);
      }

      const filterConfident = (techniques: WritingTechnique[]) =>
        techniques.filter(t => t.confidence >= 0.4).slice(0, 5).map(t => t.rule);

      const chapters = rb.content ? splitChapters(rb.content) : [];
      const sampleText = assets.sourceChapterIndices
        .map(i => chapters[i - 1]?.content?.slice(0, 500) ?? "")
        .join("\n---\n");

      const overallDescription = assets.overallStyleDescription || "从对标书提取的写作风格";
      const techniqueCount = {
        "叙事": assets.narrativeAssets.length,
        "语言": assets.languageAssets.length,
        "角色": assets.characterAssets.length,
        "节奏": assets.rhythmAssets.length,
        "反AI": assets.antiAiAssets.length,
      };

      const profile = await prisma.styleProfile.create({
        data: {
          name: `${rb.fileName.replace(/\.txt$/i, "")} 写法`,
          sourceText: sampleText.slice(0, 10000),
          narrativeRules: JSON.stringify(filterConfident(assets.narrativeAssets)),
          languageRules: JSON.stringify(filterConfident(assets.languageAssets)),
          characterRules: JSON.stringify(filterConfident(assets.characterAssets)),
          rhythmRules: JSON.stringify(filterConfident(assets.rhythmAssets)),
          antiAiRules: JSON.stringify(filterConfident(assets.antiAiAssets)),
          extractedFeatures: JSON.stringify({
            overallDescription,
            sourceChapters: assets.sourceChapterIndices.length,
            techniqueCount,
            averageConfidence: [
              ...assets.narrativeAssets,
              ...assets.languageAssets,
              ...assets.characterAssets,
              ...assets.rhythmAssets,
              ...assets.antiAiAssets,
            ].reduce((s, t) => s + t.confidence, 0) / Math.max(1,
              assets.narrativeAssets.length + assets.languageAssets.length +
              assets.characterAssets.length + assets.rhythmAssets.length + assets.antiAiAssets.length
            ),
          }),
        },
      });

      const binding = await prisma.styleBinding.create({
        data: {
          styleProfileId: profile.id,
          targetType: "novel",
          targetId: novelId,
          priority: 0,
          weight: 0.85,
          enabled: true,
        },
      });

      return { profileId: profile.id, bindingId: binding.id };
    },

    async getStatistics(novelId) {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb) throw new Error("No reference book");

      const annotations: ReferenceAnnotation = rb.annotations
        ? JSON.parse(rb.annotations) : { loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] };

      // Analyze loop distribution from boundaries
      const starts = annotations.loopBoundaries.filter(b => b.type === "start").sort((a, b) => a.chapterIndex - b.chapterIndex);
      const ends = annotations.loopBoundaries.filter(b => b.type === "end").sort((a, b) => a.chapterIndex - b.chapterIndex);

      const loopDistribution: ReferenceStatistics["loopDistribution"] = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        loopDistribution.push({
          loopIndex: i + 1,
          startChapter: starts[i].chapterIndex,
          endChapter: ends[i].chapterIndex,
          chapterCount: ends[i].chapterIndex - starts[i].chapterIndex + 1,
        });
      }

      // Cool point density map
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
        coolPointDensity.push({
          chapterIndex: i,
          level: highSet.has(i) ? "high" : lowSet.has(i) ? "low" : "neutral",
        });
      }

      // Setting timeline
      const settingTimeline = (annotations.keySettings ?? [])
        .sort((a, b) => a.chapterIndex - b.chapterIndex)
        .map(s => ({ chapterIndex: s.chapterIndex, settingName: s.settingName }));

      return {
        totalChapters: rb.totalChapters ?? 0,
        totalLoops: loopDistribution.length,
        avgChaptersPerLoop: loopDistribution.length > 0
          ? Math.round(loopDistribution.reduce((s, l) => s + l.chapterCount, 0) / loopDistribution.length)
          : null,
        loopDistribution,
        coolPointDensity,
        settingTimeline,
      };
    },
  };
}
