/**
 * Reference Book Deep Analysis Pipeline V2.
 *
 * Phases:
 *   1. Chapter parsing (regex or epub spine)
 *   2. Batch annotation — ALL chapters, full content, retry×3, resume
 *   3. Loop narrative analysis — per-loop deep analysis (coreConflict, protagonistChange, ...)
 *   4. Rhythm profile + ArchitectureProfile synthesis (statistical)
 *   5. Writing technique extraction
 *   6. Golden finger design pattern extraction
 *   7. Craft stats (opening patterns, dialogue ratio, description distribution)
 *
 * Output: single AnalysisResult JSON stored in ReferenceProfile.analysisResult.
 */
import { z } from "zod";
import { getPrisma } from "../../../platform/db/client";
import { aiInvoke } from "../../../platform/llm/aiService";
import type {
  ArchitectureProfile, LoopPhase, ChapterTypeDistribution,
  ChapterLengthStats, CoolPointRecipe, HookProfile,
  ContentBeatProfile, CharacterSystem, PayoffPatterns,
  WritingTechniques, WritingTechnique,
} from "@one2novel/shared/types/architectureProfile";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ParsedChapter {
  index: number;
  title: string;
  startChar: number;
  endChar: number;
  wordCount: number;
}

export interface ChapterAnnotation {
  chapterIndex: number;
  chapterType: "advance" | "transition" | "cooldown" | "climax";
  coolPointLevel: "high" | "medium" | "low";
  hookType: "suspense" | "reversal" | "preview" | "emotional";
  contentBeat: string;
  secondaryBeat?: string;
  conflictIntensity: number;
  openingType: "action" | "dialogue" | "environment" | "internal" | "exposition";
  summary: string;
}

export interface LoopNarrative {
  loopIndex: number;
  startChapter: number; endChapter: number;
  coreConflict: string;
  protagonistChange: string;
  keyEvents: string[];
  infoRevealed: string[];
  settlementContent: string;
  narrativeFunction: "setup" | "escalation" | "turn" | "climax" | "denouement";
  progressionFromPrevious: string;
}

export interface RhythmProfile {
  tensionCurve: number[];
  avgClimaxInterval: number;
  avgCooldownLength: number;
  tensionCycleLength: number;
  rhythmTemplate: string;
  rhythmDescription: string;
}

export interface GoldenFingerAnalysis {
  name: string;
  abilities: string[];
  limits: string[];
  designPattern: {
    type: string;
    typeDescription: string;
    coreMechanic: string;
    acquisitionPattern: string;
    evolutionPath: string[];
    limitationStrategy: string;
    narrativeIntegration: string;
    suitability: { genres: string[]; architectures: string[] };
  };
}

export interface CraftStats {
  openingPatterns: Record<string, number>;
  dominantOpening: string;
  dialogueRatio: number;
  avgDialoguePerChapter: number;
  avgDialogueLineLength: number;
  descriptionDistribution: Record<string, number>;
}

export interface AnalysisResult {
  totalChapters: number;
  completedAt: string;
  annotations: ChapterAnnotation[];
  architectureProfile: ArchitectureProfile;
  loopNarratives: LoopNarrative[];
  rhythmProfile: RhythmProfile;
  goldenFingerAnalysis: GoldenFingerAnalysis | null;
  writingTechniques: WritingTechniques | null;
  craftStats: CraftStats;
}

// ═══════════════════════════════════════════════════════════
// Phase 1: Chapter Parser
// ═══════════════════════════════════════════════════════════

export function parseChapters(text: string): ParsedChapter[] {
  const patterns = [
    /(?:^|\n)\s*第\s*([一二三四五六七八九十百千\d]+)\s*[章節节回卷]\s*(.*?)(?:\n|$)/gm,
    /(?:^|\n)\s*Chapter\s+(\d+)\s*[:：]?\s*(.*?)(?:\n|$)/gim,
    /(?:^|\n)\s*(\d{1,4})\s*[\.、．]\s*(.{2,40})(?:\n|$)/gm,
    /(?:^|\n)\s*(?:第)?\s*([一二三四五六七八九十百千\d]+)\s*卷\s*(.*?)(?:\n|$)/gm,
  ];

  const hits: Array<{ index: number; start: number; title: string }> = [];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const num = parseChineseNum(m[1]) || parseInt(m[1], 10) || (hits.length + 1);
      hits.push({ index: num, start: m.index, title: (m[2] || "").trim().slice(0, 50) });
    }
  }

  // Deduplicate within 50 chars
  hits.sort((a, b) => a.start - b.start);
  const deduped: typeof hits = [];
  for (const h of hits) {
    if (deduped.length > 0 && h.start - deduped[deduped.length - 1].start < 50) continue;
    deduped.push(h);
  }

  const chapters: ParsedChapter[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const start = deduped[i].start;
    const end = i + 1 < deduped.length ? deduped[i + 1].start : text.length;
    chapters.push({ index: i + 1, title: deduped[i].title || `第${i + 1}章`, startChar: start, endChar: end, wordCount: end - start });
  }
  return chapters;
}

function parseChineseNum(s: string): number | null {
  const map: Record<string, number> = { 一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,百:100,千:1000 };
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let result = 0, current = 0;
  for (const ch of s) {
    const v = map[ch];
    if (v === undefined) { if (/[零〇]/.test(ch)) continue; return null; }
    if (v >= 10) { current = (current || 1) * v; result += current; current = 0; } else { current = v; }
  }
  return result + current || null;
}

// ═══════════════════════════════════════════════════════════
// Phase 2: Batch Annotation
// ═══════════════════════════════════════════════════════════

const BASE_BATCH_SIZE = 15;
const MAX_CHARS_PER_BATCH = 60000;

const BatchAnnotationSchema = z.object({
  chapters: z.array(z.object({
    chapterIndex: z.number(),
    chapterType: z.enum(["advance", "transition", "cooldown", "climax"]),
    coolPointLevel: z.enum(["high", "medium", "low"]),
    hookType: z.enum(["suspense", "reversal", "preview", "emotional"]),
    contentBeat: z.string(),
    secondaryBeat: z.string().optional(),
    conflictIntensity: z.number().int().min(1).max(10),
    openingType: z.enum(["action", "dialogue", "environment", "internal", "exposition"]),
    summary: z.string(),
  })),
});

async function annotateBatch(
  chapters: ParsedChapter[], text: string, batchIndex: number, totalBatches: number, batchSize: number,
): Promise<ChapterAnnotation[]> {
  const startIdx = batchIndex * batchSize;
  const batchChapters = chapters.slice(startIdx, startIdx + batchSize);
  if (batchChapters.length === 0) return [];

  const excerpts = batchChapters.map(ch => {
    const content = text.slice(ch.startChar, ch.endChar).trim();
    return `=== 第${ch.index}章 ${ch.title} ===\n${content}`;
  }).join("\n\n");

  const userPrompt = [
    `批注 ${batchChapters.length} 章（批次 ${batchIndex + 1}/${totalBatches}）`,
    `章节目录：${batchChapters.map(c => `第${c.index}章 ${c.title}`).join("、")}`,
    "", excerpts,
  ].join("\n");

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await aiInvoke({ assetId: "novel.chapter.annotate", userPrompt, schema: BatchAnnotationSchema, temperature: 0.3 });
      return raw.chapters.filter(a => a.chapterIndex > 0);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 3) { const delay = Math.pow(2, attempt) * 1000; console.warn(`[DeepAnalysis] Batch ${batchIndex + 1} attempt ${attempt} failed, retrying in ${delay}ms`); await new Promise(r => setTimeout(r, delay)); }
    }
  }
  throw lastError || new Error(`Batch ${batchIndex + 1} failed`);
}

async function batchAnnotateChapters(
  chapters: ParsedChapter[], text: string, profileId: string,
  onProgress?: (batch: number, total: number) => Promise<void>,
): Promise<ChapterAnnotation[]> {
  const avgChapterSize = chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length;
  const batchSize = Math.max(5, Math.min(BASE_BATCH_SIZE, Math.floor(MAX_CHARS_PER_BATCH / avgChapterSize)));
  const totalBatches = Math.ceil(chapters.length / batchSize);

  const prisma = getPrisma();
  const existing = await prisma.referenceProfile.findUnique({ where: { id: profileId }, select: { chapterAnnotations: true } });
  let results: ChapterAnnotation[] = [];
  let doneIndices = new Set<number>();
  if (existing?.chapterAnnotations) {
    try { const saved = JSON.parse(existing.chapterAnnotations) as ChapterAnnotation[]; results = saved; doneIndices = new Set(saved.map(a => a.chapterIndex)); console.log(`[DeepAnalysis] Resuming: ${results.length} already annotated`); } catch {}
  }

  for (let i = 0; i < totalBatches; i++) {
    const startIdx = i * batchSize;
    if (chapters.slice(startIdx, startIdx + batchSize).every(c => doneIndices.has(c.index))) continue;
    const batch = await annotateBatch(chapters, text, i, totalBatches, batchSize);
    for (const a of batch) { const idx = results.findIndex(r => r.chapterIndex === a.chapterIndex); if (idx >= 0) results[idx] = a; else results.push(a); }
    await prisma.referenceProfile.update({ where: { id: profileId }, data: { chapterAnnotations: JSON.stringify(results.sort((a, b) => a.chapterIndex - b.chapterIndex)) } }).catch(() => {});
    console.log(`[DeepAnalysis] Batch ${i + 1}/${totalBatches}: ${batch.length} chapters (total: ${results.length})`);
    if (onProgress) await onProgress(i + 1, totalBatches);
  }
  return results.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

// ═══════════════════════════════════════════════════════════
// Phase 3: Loop Narrative Analysis
// ═══════════════════════════════════════════════════════════

const LoopDetectionSchema = z.object({ loops: z.array(z.object({ startChapter: z.number(), endChapter: z.number(), triggerHint: z.string() })) });

const LoopNarrativeSchema = z.object({
  coreConflict: z.string(), protagonistChange: z.string(),
  keyEvents: z.array(z.string()), infoRevealed: z.array(z.string()),
  settlementContent: z.string(),
  narrativeFunction: z.enum(["setup","escalation","turn","climax","denouement"]),
  progressionFromPrevious: z.string(),
});

async function analyzeLoopNarrative(
  annotations: ChapterAnnotation[], chapters: ParsedChapter[], text: string,
  loop: { startChapter: number; endChapter: number; loopIndex: number; triggerHint: string },
): Promise<LoopNarrative> {
  const loopAnnotations = annotations.filter(a => a.chapterIndex >= loop.startChapter && a.chapterIndex <= loop.endChapter);
  const annotationSummary = loopAnnotations.map(a =>
    `第${a.chapterIndex}章 type=${a.chapterType} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} beat=${a.contentBeat} hook=${a.hookType} summary=${a.summary}`
  ).join("\n");

  // Sample chapter content from this loop (first, middle, last chapters)
  const sampleChapters = [loop.startChapter, Math.round((loop.startChapter+loop.endChapter)/2), loop.endChapter];
  const samples = sampleChapters.map(idx => {
    const ch = chapters.find(c => c.index === idx);
    if (!ch) return "";
    return `--- 第${ch.index}章 ${ch.title} ---\n${text.slice(ch.startChar, Math.min(ch.startChar + 3000, ch.endChar)).trim()}`;
  }).join("\n\n");

  const raw = await aiInvoke({
    assetId: "novel.chapter.review", // reuse review prompt for its narrative analysis capability
    userPrompt: [
      `分析以下回环（第${loop.loopIndex}轮，第${loop.startChapter}-${loop.endChapter}章）的叙事结构。`,
      `触发提示：${loop.triggerHint}`,
      "",
      `【章节标注】${annotationSummary.slice(0, 6000)}`,
      "",
      `【章节样本】${samples.slice(0, 9000)}`,
    ].join("\n"),
    schema: LoopNarrativeSchema, temperature: 0.5,
  });
  return { loopIndex: loop.loopIndex, startChapter: loop.startChapter, endChapter: loop.endChapter, ...raw };
}

async function detectAndAnalyzeLoops(
  annotations: ChapterAnnotation[], chapters: ParsedChapter[], text: string,
): Promise<{ boundaries: Array<{ chapterIndex: number; type: "start"|"end"; loopIndex: number }>; narratives: LoopNarrative[] }> {
  if (annotations.length < 10) return { boundaries: [], narratives: [] };

  const climaxChapters = annotations.filter(a => a.chapterType === "climax").map(a => a.chapterIndex);
  const patternSummary = annotations.map(a =>
    `第${a.chapterIndex}章 type=${a.chapterType} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} hook=${a.hookType}`
  ).join("\n");

  const raw = await aiInvoke({
    assetId: "reference.loop.infer",
    userPrompt: [
      `根据以下 ${annotations.length} 章的标注数据，推断回环的起止边界。`,
      `高潮章位置: ${climaxChapters.join("、")}`,
      patternSummary.slice(0, 8000),
    ].join("\n"),
    schema: LoopDetectionSchema, temperature: 0.4,
  });

  const loops = raw.loops.map((l, i) => ({ ...l, loopIndex: i + 1 }));
  const boundaries = loops.flatMap(l => [
    { chapterIndex: l.startChapter, type: "start" as const, loopIndex: l.loopIndex },
    { chapterIndex: l.endChapter, type: "end" as const, loopIndex: l.loopIndex },
  ]).sort((a, b) => a.chapterIndex - b.chapterIndex);

  // Deep analysis for each loop
  const narratives: LoopNarrative[] = [];
  for (const loop of loops) {
    try {
      const n = await analyzeLoopNarrative(annotations, chapters, text, loop);
      narratives.push(n);
    } catch (e) { console.warn(`[DeepAnalysis] Loop ${loop.loopIndex} narrative analysis failed`, e); }
  }
  return { boundaries, narratives };
}

// ═══════════════════════════════════════════════════════════
// Phase 4: Rhythm Profile + ArchitectureProfile Synthesis
// ═══════════════════════════════════════════════════════════

function computeRhythmProfile(annotations: ChapterAnnotation[]): RhythmProfile {
  const tensionCurve = annotations.map(a => a.conflictIntensity);
  const climaxIndices = annotations.filter(a => a.chapterType === "climax").map(a => a.chapterIndex);
  const cooldownRuns: number[] = [];
  let currentRun = 0;
  for (const a of annotations) {
    if (a.chapterType === "cooldown") { currentRun++; } else { if (currentRun > 0) { cooldownRuns.push(currentRun); currentRun = 0; } }
  }
  if (currentRun > 0) cooldownRuns.push(currentRun);

  const climaxIntervals: number[] = [];
  for (let i = 1; i < climaxIndices.length; i++) climaxIntervals.push(climaxIndices[i] - climaxIndices[i - 1]);

  const avgClimaxInterval = climaxIntervals.length > 0 ? Math.round(climaxIntervals.reduce((a,b)=>a+b,0) / climaxIntervals.length) : 12;
  const avgCooldownLength = cooldownRuns.length > 0 ? Math.round(cooldownRuns.reduce((a,b)=>a+b,0) / cooldownRuns.length) : 1;

  // Detect rhythm template
  const diffs = tensionCurve.slice(1).map((v, i) => v - tensionCurve[i]);
  const waveCount = diffs.filter(d => Math.abs(d) >= 3).length;
  const template = waveCount > annotations.length * 0.3 ? "波浪式" : climaxIntervals.length > annotations.length / 8 ? "阶梯上升" : "平坦推进";
  const description = climaxIntervals.length > 0
    ? `约每 ${avgClimaxInterval} 章一个高潮，冷却段平均 ${avgCooldownLength} 章，整体呈${template}节奏`
    : `节奏平稳，无显著高潮周期`;

  return { tensionCurve, avgClimaxInterval, avgCooldownLength, tensionCycleLength: avgClimaxInterval + avgCooldownLength, rhythmTemplate: template, rhythmDescription: description };
}

function synthesizeProfile(
  chapters: ParsedChapter[], annotations: ChapterAnnotation[],
  loops: Array<{ startChapter: number; endChapter: number; loopIndex: number }>,
  name: string, profileId: string,
): ArchitectureProfile {
  const total = annotations.length;
  if (total === 0) throw new Error("No annotations");

  const typeCounts = { advance: 0, transition: 0, cooldown: 0, climax: 0 };
  for (const a of annotations) typeCounts[a.chapterType]++;
  const chapterTypeDistribution: ChapterTypeDistribution = {
    advance: pct(typeCounts.advance, total), transition: pct(typeCounts.transition, total),
    cooldown: pct(typeCounts.cooldown, total), climax: pct(typeCounts.climax, total),
  };

  const lengths = chapters.map(c => c.wordCount).filter(n => n > 0);
  const avgChaptersPerLoop: ChapterLengthStats = loops.length > 0 ? {
    min: Math.min(...loops.map(l => l.endChapter - l.startChapter + 1)),
    max: Math.max(...loops.map(l => l.endChapter - l.startChapter + 1)),
    avg: Math.round(loops.reduce((s, l) => s + (l.endChapter - l.startChapter + 1), 0) / loops.length),
  } : { min: 10, max: 25, avg: 18 };

  const avgChapterWordCount: ChapterLengthStats = {
    min: Math.min(...lengths), max: Math.max(...lengths),
    avg: Math.round(lengths.reduce((s, l) => s + l, 0) / lengths.length),
  };

  const coolCounts: Record<string, number> = { collect: 0, strategy: 0, verify: 0, reveal: 0, upgrade: 0, faceSlap: 0 };
  for (const a of annotations) {
    if (a.coolPointLevel === "high") {
      const beat = a.contentBeat;
      if (["修炼","赚钱"].includes(beat)) coolCounts.collect++;
      else if (["调查","推理"].includes(beat)) coolCounts.strategy++;
      else if (["显圣"].includes(beat)) coolCounts.faceSlap++;
      else if (["说明"].includes(beat)) coolCounts.reveal++;
      else coolCounts.upgrade++;
    }
  }
  const totalCool = Object.values(coolCounts).reduce((s, n) => s + n, 0) || 1;
  const coolPointRecipe: CoolPointRecipe = {
    collect: pct(coolCounts.collect, totalCool), strategy: pct(coolCounts.strategy, totalCool),
    verify: pct(coolCounts.verify, totalCool), reveal: pct(coolCounts.reveal, totalCool),
    upgrade: pct(coolCounts.upgrade, totalCool), faceSlap: pct(coolCounts.faceSlap, totalCool),
  };

  const hookCounts = { suspense: 0, reversal: 0, preview: 0, emotional: 0 };
  for (const a of annotations) hookCounts[a.hookType]++;
  const totalHooks = Object.values(hookCounts).reduce((s, n) => s + n, 0) || 1;
  const hookProfile: HookProfile = {
    shortTermPerChapter: Math.round((hookCounts.suspense + hookCounts.reversal) / total * 10) / 10 || 1,
    mediumTermPerVolume: Math.max(1, Math.round(loops.length / Math.max(1, (total / 100)) * 10) / 10 || 3),
    longTermLines: Math.max(1, Math.round(total / 100) || 4),
    hookDistribution: { suspense: pct(hookCounts.suspense, totalHooks), reversal: pct(hookCounts.reversal, totalHooks), preview: pct(hookCounts.preview, totalHooks), emotional: pct(hookCounts.emotional, totalHooks) },
  };

  const beatCounts: Record<string, number> = {};
  for (const a of annotations) { beatCounts[a.contentBeat] = (beatCounts[a.contentBeat] || 0) + 1; if (a.secondaryBeat) beatCounts[a.secondaryBeat] = (beatCounts[a.secondaryBeat] || 0) + 0.5; }
  const totalBeats = Object.values(beatCounts).reduce((s, n) => s + n, 0) || 1;
  const contentBeatProfile: ContentBeatProfile = {};
  for (const [k, c] of Object.entries(beatCounts)) contentBeatProfile[k] = Math.round(c / totalBeats * 100);

  const avgConflict = annotations.reduce((s, a) => s + a.conflictIntensity, 0) / total;
  const characterSystem: CharacterSystem = { avgTotal: Math.round(8 + avgConflict * 1.5), roleDistribution: { protagonist: 1, antagonist: Math.round(2 + avgConflict / 5), supporting: Math.round(3 + avgConflict / 3), minor: Math.round(2 + avgConflict / 3) }, avgChaptersBetweenAppearances: Math.round(total / 15), avgCharactersPerChapter: Math.round(2 + avgConflict / 3) };

  const payoffPatterns: PayoffPatterns = { avgSeedToPayoffChapters: loops.length > 0 ? Math.round(total / loops.length * 0.7) : 50, seedsPerVolume: Math.max(2, Math.round(total / 20)), typicalPayoffWindow: loops.length > 0 ? Math.round(total / loops.length) : 50 };

  const loopPhases: LoopPhase[] = [
    { phase: "trigger", label: "触发事件", description: "新副本/任务/危机的引入", typicalChapterRange: [1, 3] },
    { phase: "enter", label: "进入探索", description: "进入新环境，收集线索和资源", typicalChapterRange: [2, 5] },
    { phase: "explore", label: "深入展开", description: "副本内部展开，推进核心探索", typicalChapterRange: [3, 6] },
    { phase: "setback", label: "受挫考验", description: "遭遇重大阻碍或失败", typicalChapterRange: [1, 3] },
    { phase: "turn", label: "转折翻盘", description: "利用资源/信息实现逆转", typicalChapterRange: [1, 3] },
    { phase: "climax", label: "决战高潮", description: "与最大威胁的最终对抗", typicalChapterRange: [1, 2] },
    { phase: "settlement", label: "结算收获", description: "成果盘点，暗示下一轮方向", typicalChapterRange: [1, 2] },
  ];

  return { name, source: "reference", sourceReferenceProfileId: profileId, loopPhases, chapterTypeDistribution, avgChaptersPerLoop, avgChapterWordCount, coolPointRecipe, hookProfile, contentBeatProfile, characterSystem, payoffPatterns };
}

// ═══════════════════════════════════════════════════════════
// Phase 5: Writing Techniques
// ═══════════════════════════════════════════════════════════

const WritingExtractSchema = z.object({
  overallStyleDescription: z.string(),
  narrativeAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  languageAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  characterAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  rhythmAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  antiAiAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
});

async function extractWritingTechniques(text: string, annotations: ChapterAnnotation[]): Promise<WritingTechniques> {
  const findChapter = (type: string): string => {
    const match = annotations.find(a => a.chapterType === type || a.contentBeat === type);
    if (!match) return text.slice(0, 3000);
    const pattern = new RegExp(`第${match.chapterIndex}[章節节回].*?(?=第\\d+[章節节回]|$)`, "s");
    const found = text.match(pattern);
    return found ? found[0].slice(0, 3000) : text.slice(0, 3000);
  };
  const samples = [`【高潮场景样本】\n${findChapter("climax")}`, `【日常场景样本】\n${findChapter("cooldown")}`, `【推进场景样本】\n${findChapter("advance")}`].join("\n\n");
  const raw = await aiInvoke({ assetId: "reference.writing_assets.extract", userPrompt: samples.slice(0, 12000), schema: WritingExtractSchema, temperature: 0.5 });
  return { overallStyleDescription: raw.overallStyleDescription, narrativeAssets: raw.narrativeAssets, languageAssets: raw.languageAssets, characterAssets: raw.characterAssets, rhythmAssets: raw.rhythmAssets, antiAiAssets: raw.antiAiAssets };
}

// ═══════════════════════════════════════════════════════════
// Phase 6: Golden Finger Design Pattern
// ═══════════════════════════════════════════════════════════

const GoldenFingerSchema = z.object({
  name: z.string(), abilities: z.array(z.string()), limits: z.array(z.string()),
  designPattern: z.object({
    type: z.string(), typeDescription: z.string(), coreMechanic: z.string(),
    acquisitionPattern: z.string(), evolutionPath: z.array(z.string()),
    limitationStrategy: z.string(), narrativeIntegration: z.string(),
    suitability: z.object({ genres: z.array(z.string()), architectures: z.array(z.string()) }),
  }),
});

async function extractGoldenFinger(text: string): Promise<GoldenFingerAnalysis | null> {
  try {
    const raw = await aiInvoke({
      assetId: "reference.golden-finger.extract",
      userPrompt: [
        text.slice(0, 80000),
        "",
        "提取金手指后，分析其设计模式：类型（如\"信息差型\"）、核心机制、获取模式、进化路径、限制策略、叙事融合方式，以及适合的题材和架构类型。",
      ].join("\n"),
      schema: GoldenFingerSchema, temperature: 0.5,
    });
    return raw;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// Phase 7: Craft Stats (opening patterns, dialogue, description)
// ═══════════════════════════════════════════════════════════

function computeCraftStats(annotations: ChapterAnnotation[], text: string): CraftStats {
  // Opening patterns from annotations
  const openingPatterns: Record<string, number> = {};
  for (const a of annotations) { openingPatterns[a.openingType] = (openingPatterns[a.openingType] || 0) + 1; }
  const entries = Object.entries(openingPatterns).sort(([,a],[,b]) => b - a);
  const dominantOpening = entries.length > 0 ? `${entries[0][0]} (${pct(entries[0][1], annotations.length)}%)` : "unknown";

  // Dialogue ratio: count lines starting with quotes vs total lines
  const sample = text.slice(0, 100000);
  const lines = sample.split("\n").filter(l => l.trim());
  const dialogueLines = lines.filter(l => /^[「「\"'“‘].*[」」\"'”’]$/.test(l.trim()) || /^[「「\"'“‘]/.test(l.trim())).length;
  const dialogueRatio = lines.length > 0 ? Math.round(dialogueLines / lines.length * 100) : 30;

  // Description distribution: keyword-based estimation
  const visual = (sample.match(/[色光暗亮红蓝绿黑白金]/g) || []).length;
  const action = (sample.match(/[打攻击杀砍刺挥踢跳跃翻滚]/g) || []).length;
  const internal = (sample.match(/[想想觉得感到似乎也许可能内心]/g) || []).length;
  const total = visual + action + internal || 1;
  const descriptionDistribution: Record<string, number> = {
    visual: Math.round(visual / total * 100), action: Math.round(action / total * 100), internal: Math.round(internal / total * 100), sensory: Math.round(Math.max(0, 100 - (visual + action + internal) / total * 100)),
  };

  return { openingPatterns, dominantOpening, dialogueRatio, avgDialoguePerChapter: Math.round(dialogueLines / Math.max(1, annotations.length)), avgDialogueLineLength: 15, descriptionDistribution };
}

// ═══════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════

async function updateProgress(profileId: string, phase: string, detail: string, pct: number) {
  try { await getPrisma().referenceProfile.update({ where: { id: profileId }, data: { deepAnalysisProgress: JSON.stringify({ phase, detail, pct }) } }); } catch {}
}

export async function deepAnalyze(profileId: string): Promise<AnalysisResult> {
  const prisma = getPrisma();
  const profile = await prisma.referenceProfile.findUnique({ where: { id: profileId } });
  if (!profile?.content) throw new Error("Profile has no content");
  let text = profile.content;
  const name = profile.name || "未命名参考书";

  console.log(`[DeepAnalysis] Starting for "${name}" (${text.length} chars)`);

  // Phase 1
  await updateProgress(profileId, "parse", "解析章节目录...", 5);
  let chapters: ParsedChapter[];
  if (text.startsWith("[") && text.includes('"title"') && text.includes('"content"')) {
    const rawChapters = JSON.parse(text) as { title: string; content: string }[];
    let pos = 0;
    chapters = rawChapters.map((c, i) => { const start = pos; pos += c.content.length + 2; return { index: i + 1, title: c.title, startChar: start, endChar: pos, wordCount: c.content.length }; });
    text = rawChapters.map(c => c.content).join("\n\n");
    console.log(`[DeepAnalysis] ${chapters.length} chapters (epub spine)`);
  } else {
    chapters = parseChapters(text);
    console.log(`[DeepAnalysis] ${chapters.length} chapters (regex)`);
  }
  await updateProgress(profileId, "parse", `${chapters.length} 章`, 8);

  // Phase 2
  const totalBatchesEst = Math.ceil(chapters.length / BASE_BATCH_SIZE);
  await updateProgress(profileId, "annotate", `标注章节 (0/${totalBatchesEst} 批)...`, 10);
  const annotations = await batchAnnotateChapters(chapters, text, profileId, async (batch, total) => {
    await updateProgress(profileId, "annotate", `标注章节 (${batch}/${total} 批)`, 10 + Math.round(batch / total * 40));
  });
  console.log(`[DeepAnalysis] ${annotations.length} annotations`);
  await updateProgress(profileId, "annotate", `${annotations.length} 章标注完成`, 50);

  // Phase 3
  await updateProgress(profileId, "loops", "回环检测 + 叙事分析...", 52);
  const { boundaries, narratives: loopNarratives } = await detectAndAnalyzeLoops(annotations, chapters, text);
  console.log(`[DeepAnalysis] ${loopNarratives.length} loops analyzed`);
  await updateProgress(profileId, "loops", `${loopNarratives.length} 轮回环分析完成`, 65);

  // Phase 4
  await updateProgress(profileId, "synthesize", "节奏分析 + 统计合成...", 68);
  const rhythmProfile = computeRhythmProfile(annotations);
  const loops = loopNarratives.map(n => ({ startChapter: n.startChapter, endChapter: n.endChapter, loopIndex: n.loopIndex }));
  const architectureProfile = synthesizeProfile(chapters, annotations, loops, name, profileId);
  await updateProgress(profileId, "synthesize", "统计合成完成", 78);

  // Phase 5
  await updateProgress(profileId, "writing", "提取写法技法...", 80);
  let writingTechniques: WritingTechniques | null = null;
  try { writingTechniques = await extractWritingTechniques(text, annotations); architectureProfile.writingTechniques = writingTechniques; console.log("[DeepAnalysis] Writing techniques extracted"); } catch (e) { console.warn("[DeepAnalysis] Writing techniques failed", e); }
  await updateProgress(profileId, "writing", "技法提取完成", 85);

  // Phase 6
  await updateProgress(profileId, "goldenFinger", "金手指设计模式...", 88);
  const goldenFingerAnalysis = await extractGoldenFinger(text);
  console.log(`[DeepAnalysis] Golden finger: ${goldenFingerAnalysis?.designPattern.type ?? "failed"}`);

  // Phase 7
  await updateProgress(profileId, "craft", "三页统计...", 93);
  const craftStats = computeCraftStats(annotations, text);
  console.log(`[DeepAnalysis] Craft stats: ${craftStats.dominantOpening}`);

  // Assemble result
  const result: AnalysisResult = {
    totalChapters: chapters.length,
    completedAt: new Date().toISOString(),
    annotations,
    architectureProfile,
    loopNarratives,
    rhythmProfile,
    goldenFingerAnalysis,
    writingTechniques,
    craftStats,
  };

  // Persist
  await updateProgress(profileId, "persist", "保存...", 97);
  await prisma.referenceProfile.update({
    where: { id: profileId },
    data: { deepAnalysisProgress: null, analysisResult: JSON.stringify(result) },
  });

  console.log(`[DeepAnalysis] Complete — ${chapters.length} chapters, ${loopNarratives.length} loops`);
  return result;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 100) : 0;
}
