/**
 * Reference Book Service — thin adapter layer for the deep ReferenceAnalyzer module.
 *
 * All analysis logic lives in `referenceAnalyzer.ts`. This module exposes
 * CRUD + analysis delegation as a plain object (no factory overhead).
 */

import { getPrisma } from "../../../platform/db/client";
import type { ContentBeatAnnotation } from "@one2novel/shared/types/novel";
import { REF_BOOK_CONTENT_SLICE, REF_PROMPT_SLICE } from "../../../platform/config/constants";
import {
  inferLoops,
  inferCoolPoints,
  detectArchitecture,
  extractHookPatterns,
  extractGoldenFingerBounds,
  extractSettingTimeline,
  extractContentBeats,
  extractWritingAssets,
  getStatistics,
  type ReferenceAnnotation,
  type WritingAssetCollection,
  type WritingTechnique,
  type GoldenFingerBounds,
  type ArchitectureDetection,
  type HookPatternResult,
} from "./referenceAnalyzer";

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

// ─── Service (plain object, no factory) ────────────────

export const referenceBookService = {
    async upload(novelId: string, fileName: string, content: string): Promise<ReferenceBookData> {
      const prisma = getPrisma();
      const totalChapters = content.match(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gmi)?.length ?? 1;
      const rb = await prisma.referenceBook.upsert({
        where: { novelId },
        create: {
          novelId, fileName, content: content.slice(0, 100000),
          totalChapters,
          annotations: JSON.stringify({ loopBoundaries: [], highCoolChapters: [], lowCoolChapters: [], keySettings: [] }),
        },
        update: { fileName, content: content.slice(0, 100000), totalChapters },
      });

      const chapters: ChapterPreview[] = [];
      const matches: Array<{ index: number; title: string }> = [];
      const regex = new RegExp(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gim.source, "gim");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) matches.push({ index: match.index, title: match[0].trim() });
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i < matches.length - 1 ? matches[i + 1].index : content.length;
        chapters.push({ index: i + 1, title: matches[i].title, charStart: start, charEnd: end, estimatedWords: end - start });
      }

      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: content.slice(0, REF_PROMPT_SLICE),
        chapters,
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async get(novelId: string): Promise<ReferenceBookData | null> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb) return null;
      const chapters: ChapterPreview[] = [];
      if (rb.content) {
        const matches: string[] = rb.content.match(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gim) ?? [];
        matches.forEach((m, i) => chapters.push({ index: i + 1, title: m.trim(), charStart: 0, charEnd: 0, estimatedWords: 0 }));
      }
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: rb.content,
        chapters,
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async remove(novelId: string): Promise<void> {
      const prisma = getPrisma();
      await prisma.referenceBook.deleteMany({ where: { novelId } });
    },

    async getChapters(novelId: string): Promise<ChapterPreview[]> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) return [];
      const chapters: ChapterPreview[] = [];
      const matches: string[] = rb.content.match(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gim) ?? [];
      matches.forEach((m, i) => chapters.push({ index: i + 1, title: m.trim(), charStart: 0, charEnd: 0, estimatedWords: 0 }));
      return chapters;
    },

    async getChapterContent(novelId: string, chapterIndex: number): Promise<string | null> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb?.content) return null;
      const matches: number[] = [];
      const regex = new RegExp(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gim.source, "gim");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(rb.content)) !== null) matches.push(match.index);
      const idx = chapterIndex - 1;
      if (idx < 0 || idx >= matches.length) return null;
      const start = matches[idx];
      const end = idx + 1 < matches.length ? matches[idx + 1] : rb.content.length;
      return rb.content.slice(start, end).slice(0, 8000);
    },

    async saveAnnotations(novelId: string, annotations: ReferenceAnnotation): Promise<ReferenceBookData> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.update({
        where: { novelId },
        data: { annotations: JSON.stringify(annotations) },
      });
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: null, chapters: [],
        annotations,
        analysisSummary: rb.analysisSummary ? JSON.parse(rb.analysisSummary) : null,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    async saveAnalysis(novelId: string, summary: unknown): Promise<ReferenceBookData> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.update({
        where: { novelId },
        data: { analysisSummary: JSON.stringify(summary) },
      });
      return {
        id: rb.id, novelId: rb.novelId, fileName: rb.fileName,
        totalChapters: rb.totalChapters, content: null, chapters: [],
        annotations: rb.annotations ? JSON.parse(rb.annotations) : null,
        analysisSummary: summary,
        createdAt: rb.createdAt.toISOString(), updatedAt: rb.updatedAt.toISOString(),
      };
    },

    // ── Delegated to deep ReferenceAnalyzer module ──

    inferLoops,
    inferCoolPoints,
    async getStatistics(novelId: string): Promise<unknown> { return getStatistics(novelId); },
    async extractWritingAssets(novelId: string): Promise<WritingAssetCollection> { return extractWritingAssets(novelId); },
    async createStyleProfileFromAssets(novelId: string): Promise<{ profileId: string; bindingId: string }> {
      const prisma = getPrisma();
      const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
      if (!rb) throw new Error("No reference book");

      let assets: WritingAssetCollection;
      if (rb.writingAssets) {
        try { assets = JSON.parse(rb.writingAssets) as WritingAssetCollection; } catch { assets = await extractWritingAssets(novelId); }
      } else {
        assets = await extractWritingAssets(novelId);
      }

      const filterConfident = (techniques: WritingTechnique[]) =>
        techniques.filter(t => t.confidence >= 0.4).slice(0, 5).map(t => t.rule);

      const chapters: ChapterPreview[] = [];
      if (rb.content) {
        const matches: string[] = rb.content.match(/(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万]+[章節节]|Chapter\s+\d+)/gim) ?? [];
        matches.forEach((m, i) => chapters.push({ index: i + 1, title: m.trim(), charStart: 0, charEnd: 0, estimatedWords: 0 }));
      }
      const sampleText = assets.sourceChapterIndices
        .map(i => chapters[i - 1]?.title ?? "")
        .join("\n---\n");

      const overallDescription = assets.overallStyleDescription || "从对标书提取的写作风格";
      const techniqueCount = {
        "叙事": assets.narrativeAssets.length, "语言": assets.languageAssets.length,
        "角色": assets.characterAssets.length, "节奏": assets.rhythmAssets.length,
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
            overallDescription, sourceChapters: assets.sourceChapterIndices.length,
            techniqueCount,
            averageConfidence: [
              ...assets.narrativeAssets, ...assets.languageAssets, ...assets.characterAssets,
              ...assets.rhythmAssets, ...assets.antiAiAssets,
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
          targetType: "novel", targetId: novelId,
          priority: 0, weight: 0.85, enabled: true,
        },
      });

      return { profileId: profile.id, bindingId: binding.id };
    },
    detectArchitecture,
    extractHookPatterns,
    extractGoldenFingerBounds,
    extractSettingTimeline,
    extractContentBeats,
};
