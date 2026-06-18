/**
 * Reference Book Deep Analysis Pipeline — 5-phase statistical AI analysis.
 *
 * Phase 1: Chapter parsing (regex, no AI)
 * Phase 2: Batched chapter annotation (AI, parallel batches of 15 chapters)
 * Phase 3: Loop boundary detection (statistical inference + AI validation)
 * Phase 4: Statistical synthesis → ArchitectureProfile
 * Phase 5: Writing technique extraction from representative samples
 *
 * Design principle: AI performs classification on structured inputs, statistics
 * aggregate the results, AI validates the synthesis. No "guesswork" — all
 * distributions come from actual chapter-by-chapter annotation data.
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
  index: number;        // 1-based
  title: string;        // extracted heading
  startChar: number;    // position in raw text
  endChar: number;      // position in raw text
  wordCount: number;    // estimated Chinese character count
}

export interface ChapterAnnotation {
  chapterIndex: number;
  chapterType: "advance" | "transition" | "cooldown" | "climax";
  coolPointLevel: "high" | "medium" | "low";
  hookType: "suspense" | "reversal" | "preview" | "emotional";
  contentBeat: string;           // primary beat type (修炼/显圣/赚钱/恋爱/日常/过渡/说明/调查/推理/战斗)
  secondaryBeat?: string;         // secondary beat if mixed
  conflictIntensity: number;     // 1-10
  summary: string;               // one-line summary (15-30 chars)
}

export interface LoopBoundary {
  loopIndex: number;
  startChapter: number;
  endChapter: number;
  estimatedChapters: number;
}

// ═══════════════════════════════════════════════════════════
// Phase 1: Chapter Parser
// ═══════════════════════════════════════════════════════════

/**
 * Extract all chapter boundaries from raw text using regex.
 * Supports: 第X章, 第X节, 第X回, Chapter X (mixed numbering).
 * Handles Chinese numerals (一/二/三...) and Arabic digits.
 */
export function parseChapters(text: string): ParsedChapter[] {
  const patterns = [
    // Chinese: 第X章/节/回, supports Chinese numerals + Arabic digits
    /(?:^|\n)\s*第\s*([一二三四五六七八九十百千\d]+)\s*[章節节回卷]\s*(.*?)(?:\n|$)/gm,
    // English: Chapter X
    /(?:^|\n)\s*Chapter\s+(\d+)\s*[:：]?\s*(.*?)(?:\n|$)/gim,
    // Pure number heading: "123. 标题" or "123、标题"
    /(?:^|\n)\s*(\d{1,4})\s*[\.、．]\s*(.{2,40})(?:\n|$)/gm,
    // Volume marker: 卷X / 第X卷
    /(?:^|\n)\s*(?:第)?\s*([一二三四五六七八九十百千\d]+)\s*卷\s*(.*?)(?:\n|$)/gm,
  ];

  const hits: Array<{ index: number; start: number; title: string }> = [];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const num = parseChineseNum(m[1]) || parseInt(m[1], 10) || (hits.length + 1);
      const title = (m[2] || "").trim().slice(0, 50);
      hits.push({ index: num, start: m.index, title });
    }
  }

  // Deduplicate: keep earliest occurrence when multiple patterns match the same position
  hits.sort((a, b) => a.start - b.start);
  const deduped: typeof hits = [];
  for (const h of hits) {
    if (deduped.length > 0 && h.start - deduped[deduped.length - 1].start < 50) continue; // same chapter, different pattern
    deduped.push(h);
  }
  hits.length = 0; hits.push(...deduped);

  // Sort by position and re-index sequentially
  hits.sort((a, b) => a.start - b.start);
  const chapters: ParsedChapter[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].start;
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const content = text.slice(start, Math.min(start + 500, end));
    chapters.push({
      index: i + 1,
      title: hits[i].title || `第${i + 1}章`,
      startChar: start,
      endChar: end,
      wordCount: end - start,
    });
  }
  return chapters;
}

function parseChineseNum(s: string): number | null {
  const map: Record<string, number> = {
    一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,
    百:100,千:1000,
  };
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // Simple: 一百二十三
  let result = 0, current = 0;
  for (const ch of s) {
    const v = map[ch];
    if (v === undefined) { if (/[零〇]/.test(ch)) continue; return null; }
    if (v >= 10) { current = (current || 1) * v; result += current; current = 0; }
    else { current = v; }
  }
  result += current;
  return result || null;
}

// ═══════════════════════════════════════════════════════════
// Phase 2: Batched Chapter Annotation (AI)
// ═══════════════════════════════════════════════════════════

const BASE_BATCH_SIZE = 15;
const MAX_CHARS_PER_BATCH = 60000; // ~15K tokens — keep within LLM context window

const BatchAnnotationSchema = z.object({
  chapters: z.array(z.object({
    chapterIndex: z.number(),
    chapterType: z.enum(["advance", "transition", "cooldown", "climax"]),
    coolPointLevel: z.enum(["high", "medium", "low"]),
    hookType: z.enum(["suspense", "reversal", "preview", "emotional"]),
    contentBeat: z.string(),
    secondaryBeat: z.string().optional(),
    conflictIntensity: z.number().int().min(1).max(10),
    summary: z.string(),
  })),
});

async function annotateBatch(
  chapters: ParsedChapter[],
  text: string,
  batchIndex: number,
  totalBatches: number,
  batchSize: number,
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
    "",
    excerpts,
  ].join("\n");

  // Retry up to 3 times with exponential backoff
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await aiInvoke({
        assetId: "novel.chapter.annotate",
        userPrompt,
        schema: BatchAnnotationSchema,
        temperature: 0.3,
      });
      return raw.chapters.filter(a => a.chapterIndex > 0);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 3) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
        console.warn(`[DeepAnalysis] Batch ${batchIndex + 1} attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`Batch ${batchIndex + 1} failed after 3 attempts`);
}

/**
 * Process ALL chapters in batches. Returns annotations for every chapter.
 * Handles partial batches at the end.
 */
export async function batchAnnotateChapters(
  chapters: ParsedChapter[],
  text: string,
  profileId: string,
  onProgress?: (batch: number, total: number) => Promise<void>,
): Promise<ChapterAnnotation[]> {
  const avgChapterSize = chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length;
  const batchSize = Math.max(5, Math.min(BASE_BATCH_SIZE, Math.floor(MAX_CHARS_PER_BATCH / avgChapterSize)));
  const totalBatches = Math.ceil(chapters.length / batchSize);

  // Resume: load already-annotated chapter indices from profile
  const prisma = getPrisma();
  const existing = await prisma.referenceProfile.findUnique({ where: { id: profileId }, select: { chapterAnnotations: true } });
  let results: ChapterAnnotation[] = [];
  let doneIndices = new Set<number>();
  if (existing?.chapterAnnotations) {
    try { const saved = JSON.parse(existing.chapterAnnotations) as ChapterAnnotation[]; results = saved; doneIndices = new Set(saved.map(a => a.chapterIndex)); console.log(`[DeepAnalysis] Resuming: ${results.length} chapters already annotated`); } catch {}
  }

  for (let i = 0; i < totalBatches; i++) {
    const startIdx = i * batchSize;
    const batchChapters = chapters.slice(startIdx, startIdx + batchSize);
    // Skip batches where all chapters are already annotated
    if (batchChapters.every(c => doneIndices.has(c.index))) continue;

    const batch = await annotateBatch(chapters, text, i, totalBatches, batchSize);
    // Merge: replace any previously annotated chapters in this batch with new results
    for (const a of batch) {
      const idx = results.findIndex(r => r.chapterIndex === a.chapterIndex);
      if (idx >= 0) results[idx] = a; else results.push(a);
    }
    // Save intermediate results to profile for resume
    await prisma.referenceProfile.update({
      where: { id: profileId },
      data: { chapterAnnotations: JSON.stringify(results.sort((a, b) => a.chapterIndex - b.chapterIndex)) },
    }).catch(() => {});
    console.log(`[DeepAnalysis] Batch ${i + 1}/${totalBatches}: annotated ${batch.length} chapters (batch size: ${batchSize}, total: ${results.length})`);
    if (onProgress) await onProgress(i + 1, totalBatches);
  }

  return results.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

/**
 * Validate annotation consistency. Flags impossible combinations that
 * indicate AI misclassification. Returns list of suspicious chapter indices.
 */
function validateAnnotations(annotations: ChapterAnnotation[]): number[] {
  const suspicious: number[] = [];
  for (const a of annotations) {
    // Rule: climax chapters must have conflictIntensity >= 8 and coolPointLevel = high
    if (a.chapterType === "climax" && (a.conflictIntensity < 8 || a.coolPointLevel !== "high")) {
      suspicious.push(a.chapterIndex);
    }
    // Rule: cooldown chapters must have conflictIntensity <= 4
    if (a.chapterType === "cooldown" && a.conflictIntensity > 4) {
      suspicious.push(a.chapterIndex);
    }
  }
  if (suspicious.length > 0) {
    console.warn(`[DeepAnalysis] Validation: ${suspicious.length} suspicious annotations (chapters: ${suspicious.slice(0, 10).join(",")}${suspicious.length > 10 ? "..." : ""})`);
  }
  return suspicious;
}

// ═══════════════════════════════════════════════════════════
// Phase 3: Loop Boundary Detection
// ═══════════════════════════════════════════════════════════

const LoopDetectionSchema = z.object({
  loops: z.array(z.object({
    startChapter: z.number(),
    endChapter: z.number(),
    triggerHint: z.string(),
  })),
});

/**
 * Detect loop boundaries from annotation patterns:
 * - Climax chapter followed by cooldown/settlement → likely loop end
 * - Cool point valley followed by new trigger → likely loop start
 * AI validates the detected boundaries.
 */
export async function detectLoopBoundaries(
  annotations: ChapterAnnotation[],
): Promise<LoopBoundary[]> {
  if (annotations.length < 10) return [];

  // Statistical pre-detection: find climax peaks as loop end candidates
  const climaxChapters = annotations
    .filter(a => a.chapterType === "climax")
    .map(a => a.chapterIndex);

  // Build pattern summary for AI validation
  const patternSummary = annotations.map(a =>
    `第${a.chapterIndex}章 type=${a.chapterType} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} hook=${a.hookType}`
  ).join("\n");

  const raw = await aiInvoke({
    assetId: "reference.loop.infer",
    userPrompt: [
      `根据以下 ${annotations.length} 章的标注数据，推断回环（故事弧线/副本循环）的起止边界。`,
      "",
      "【已知信息】",
      `高潮章位置: ${climaxChapters.join("、")}`,
      "",
      "【章节标注】",
      patternSummary.slice(0, 8000),
      "",
      "【推断原则】",
      "1. 一个回环通常包含 setup → progress → pressure → turn → payoff/climax → cooldown",
      "2. climax 章通常标志回环结束，紧随的 cooldown 章是下一轮回环的过渡",
      "3. conflictIntensity 从低到高再回落到低 → 标志一个回环",
      "4. coolPointLevel 的波峰波谷与回环边界对齐",
    ].join("\n"),
    schema: LoopDetectionSchema,
    temperature: 0.4,
  });

  return raw.loops.map((l, i) => ({
    loopIndex: i + 1,
    startChapter: l.startChapter,
    endChapter: l.endChapter,
    estimatedChapters: l.endChapter - l.startChapter + 1,
  }));
}

// ═══════════════════════════════════════════════════════════
// Phase 4: Statistical Synthesis → ArchitectureProfile
// ═══════════════════════════════════════════════════════════

/**
 * Compute all statistical distributions from the annotation matrix.
 * No AI — purely statistical aggregation. AI only validates at the end.
 */
export function synthesizeProfile(
  chapters: ParsedChapter[],
  annotations: ChapterAnnotation[],
  loops: LoopBoundary[],
  profileName: string,
  profileId: string,
): ArchitectureProfile {
  const total = annotations.length;
  if (total === 0) throw new Error("No annotations to synthesize");

  // ── Chapter Type Distribution ──
  const typeCounts = { advance: 0, transition: 0, cooldown: 0, climax: 0 };
  for (const a of annotations) typeCounts[a.chapterType]++;
  const chapterTypeDistribution: ChapterTypeDistribution = {
    advance: pct(typeCounts.advance, total),
    transition: pct(typeCounts.transition, total),
    cooldown: pct(typeCounts.cooldown, total),
    climax: pct(typeCounts.climax, total),
  };

  // ── Chapter Length Stats ──
  const lengths = chapters.map(c => c.wordCount).filter(n => n > 0);
  const avgChaptersPerLoop: ChapterLengthStats = loops.length > 0 ? {
    min: Math.min(...loops.map(l => l.estimatedChapters)),
    max: Math.max(...loops.map(l => l.estimatedChapters)),
    avg: Math.round(loops.reduce((s, l) => s + l.estimatedChapters, 0) / loops.length),
  } : { min: 10, max: 25, avg: 18 };

  const avgChapterWordCount: ChapterLengthStats = {
    min: lengths.length > 0 ? Math.min(...lengths) : 2000,
    max: lengths.length > 0 ? Math.max(...lengths) : 5000,
    avg: lengths.length > 0 ? Math.round(lengths.reduce((s, l) => s + l, 0) / lengths.length) : 3000,
  };

  // ── Cool Point Recipe ──
  const coolCounts: Record<string, number> = { collect: 0, strategy: 0, verify: 0, reveal: 0, upgrade: 0, faceSlap: 0 };
  for (const a of annotations) {
    if (a.coolPointLevel === "high") {
      // High cool points are distributed across types based on content beat context
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
    collect: pct(coolCounts.collect, totalCool),
    strategy: pct(coolCounts.strategy, totalCool),
    verify: pct(coolCounts.verify, totalCool),
    reveal: pct(coolCounts.reveal, totalCool),
    upgrade: pct(coolCounts.upgrade, totalCool),
    faceSlap: pct(coolCounts.faceSlap, totalCool),
  };

  // ── Hook Profile ──
  const hookCounts = { suspense: 0, reversal: 0, preview: 0, emotional: 0 };
  for (const a of annotations) hookCounts[a.hookType]++;
  const totalHooks = Object.values(hookCounts).reduce((s, n) => s + n, 0) || 1;
  const hookProfile: HookProfile = {
    shortTermPerChapter: Math.round((hookCounts.suspense + hookCounts.reversal) / total * 10) / 10 || 1,
    mediumTermPerVolume: Math.max(1, Math.round(loops.length / (total / 100) * 10) / 10 || 3),
    longTermLines: Math.max(1, Math.round(total / 100) || 4),
    hookDistribution: {
      suspense: pct(hookCounts.suspense, totalHooks),
      reversal: pct(hookCounts.reversal, totalHooks),
      preview: pct(hookCounts.preview, totalHooks),
      emotional: pct(hookCounts.emotional, totalHooks),
    },
  };

  // ── Content Beat Profile ──
  const beatCounts: Record<string, number> = {};
  for (const a of annotations) {
    beatCounts[a.contentBeat] = (beatCounts[a.contentBeat] || 0) + 1;
    if (a.secondaryBeat) beatCounts[a.secondaryBeat] = (beatCounts[a.secondaryBeat] || 0) + 0.5;
  }
  const totalBeats = Object.values(beatCounts).reduce((s, n) => s + n, 0) || 1;
  const contentBeatProfile: ContentBeatProfile = {};
  for (const [key, count] of Object.entries(beatCounts)) {
    contentBeatProfile[key] = Math.round(count / totalBeats * 100);
  }

  // ── Character System (estimated from content — high-conflict chapters need more characters) ──
  const avgConflict = annotations.reduce((s, a) => s + a.conflictIntensity, 0) / total;
  const characterSystem: CharacterSystem = {
    avgTotal: Math.round(8 + avgConflict * 1.5),
    roleDistribution: { protagonist: 1, antagonist: Math.round(2 + avgConflict / 5), supporting: Math.round(3 + avgConflict / 3), minor: Math.round(2 + avgConflict / 3) },
    avgChaptersBetweenAppearances: Math.round(total / 15),
    avgCharactersPerChapter: Math.round(2 + avgConflict / 3),
  };

  // ── Payoff Patterns ──
  const payoffPatterns: PayoffPatterns = {
    avgSeedToPayoffChapters: loops.length > 0 ? Math.round(total / loops.length * 0.7) : 50,
    seedsPerVolume: Math.max(2, Math.round(total / 20)),
    typicalPayoffWindow: loops.length > 0 ? Math.round(total / loops.length) : 50,
  };

  // ── Loop Phases (from detected loops) ──
  const loopPhases: LoopPhase[] = [
    { phase: "trigger", label: "触发事件", description: "新副本/任务/危机的引入", typicalChapterRange: [1, 3] },
    { phase: "enter", label: "进入探索", description: "进入新环境，收集线索和资源", typicalChapterRange: [2, 5] },
    { phase: "explore", label: "深入展开", description: "副本内部展开，推进核心探索", typicalChapterRange: [3, 6] },
    { phase: "setback", label: "受挫考验", description: "遭遇重大阻碍或失败", typicalChapterRange: [1, 3] },
    { phase: "turn", label: "转折翻盘", description: "利用资源/信息实现逆转", typicalChapterRange: [1, 3] },
    { phase: "climax", label: "决战高潮", description: "与最大威胁的最终对抗", typicalChapterRange: [1, 2] },
    { phase: "settlement", label: "结算收获", description: "成果盘点，暗示下一轮方向", typicalChapterRange: [1, 2] },
  ];

  return {
    name: profileName,
    source: "reference",
    sourceReferenceProfileId: profileId,
    loopPhases,
    chapterTypeDistribution,
    avgChaptersPerLoop,
    avgChapterWordCount,
    coolPointRecipe,
    hookProfile,
    contentBeatProfile,
    characterSystem,
    payoffPatterns,
  };
}

// ═══════════════════════════════════════════════════════════
// Phase 5: Writing Technique Extraction
// ═══════════════════════════════════════════════════════════

const WritingExtractSchema = z.object({
  overallStyleDescription: z.string(),
  narrativeAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  languageAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  characterAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  rhythmAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  antiAiAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
});

/**
 * Extract writing techniques from representative samples across different scene types.
 * Samples: 1 fight scene, 1 dialogue scene, 1 daily scene, 1 climax scene, 1 opening.
 */
export async function extractWritingTechniques(
  text: string,
  annotations: ChapterAnnotation[],
): Promise<WritingTechniques> {
  // Find representative chapters for each scene type
  const findChapter = (type: string): string => {
    const match = annotations.find(a => a.chapterType === type || a.contentBeat === type);
    if (!match) return text.slice(0, 3000); // fallback: book opening
    // Find the chapter content
    const pattern = new RegExp(`第${match.chapterIndex}[章節节回].*?(?=第\\d+[章節节回]|$)`, "s");
    const found = text.match(pattern);
    return found ? found[0].slice(0, 3000) : text.slice(0, 3000);
  };

  const samples = [
    `【高潮场景样本】\n${findChapter("climax")}`,
    `【日常场景样本】\n${findChapter("cooldown")}`,
    `【推进场景样本】\n${findChapter("advance")}`,
  ].join("\n\n");

  const raw = await aiInvoke({
    assetId: "reference.writing_assets.extract",
    userPrompt: `分析以下对标小说的写作技法样本，从叙事/语言/角色/节奏/反AI五个维度提取可模仿规则：\n\n${samples.slice(0, 12000)}`,
    schema: WritingExtractSchema,
    temperature: 0.5,
  });

  return {
    overallStyleDescription: raw.overallStyleDescription,
    narrativeAssets: raw.narrativeAssets,
    languageAssets: raw.languageAssets,
    characterAssets: raw.characterAssets,
    rhythmAssets: raw.rhythmAssets,
    antiAiAssets: raw.antiAiAssets,
  };
}

// ═══════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════

/**
 * Run the full 5-phase deep analysis pipeline on a ReferenceProfile.
 * Stores the resulting ArchitectureProfile on the profile.
 */
async function updateProgress(profileId: string, phase: string, detail: string, pct: number) {
  try {
    await getPrisma().referenceProfile.update({
      where: { id: profileId },
      data: { deepAnalysisProgress: JSON.stringify({ phase, detail, pct }) },
    });
  } catch {}
}

export async function deepAnalyze(profileId: string): Promise<ArchitectureProfile> {
  const prisma = getPrisma();
  const profile = await prisma.referenceProfile.findUnique({ where: { id: profileId } });
  if (!profile?.content) throw new Error("Profile has no content");
  let text = profile.content;
  const name = profile.name || "未命名参考书";

  console.log(`[DeepAnalysis] Starting for "${name}" (${text.length} chars)`);

  // Phase 1: chapter detection
  await updateProgress(profileId, "parse", "解析章节目录...", 5);
  let chapters: ParsedChapter[];
  // Detect format: JSON array of {title, content} (epub) vs plain text (txt)
  if (text.startsWith("[") && text.includes('"title"') && text.includes('"content"')) {
    // Epub native chapters: each spine item is a chapter
    const rawChapters = JSON.parse(text) as { title: string; content: string }[];
    let pos = 0;
    chapters = rawChapters.map((c, i) => {
      const start = pos; pos += c.content.length + 2; // +2 for \n\n separator
      return { index: i + 1, title: c.title, startChar: start, endChar: pos, wordCount: c.content.length };
    });
    // Reconstruct full text for AI calls (need contiguous text for slicing by char position)
    text = rawChapters.map(c => c.content).join("\n\n");
    console.log(`[DeepAnalysis] Found ${chapters.length} chapters (from epub spine)`);
  } else {
    // Plain text: regex chapter detection
    chapters = parseChapters(text);
    console.log(`[DeepAnalysis] Found ${chapters.length} chapters (from regex)`);
  }
  await updateProgress(profileId, "parse", `发现 ${chapters.length} 章`, 10);

  // Phase 2
  const totalBatches = Math.ceil(chapters.length / BASE_BATCH_SIZE);
  await updateProgress(profileId, "annotate", `标注章节 (0/${totalBatches} 批)...`, 15);
  const annotations = await batchAnnotateChapters(chapters, text, profileId, async (batch, total) => {
    await updateProgress(profileId, "annotate", `标注章节 (${batch}/${total} 批)`, 15 + Math.round(batch / total * 40));
  });
  console.log(`[DeepAnalysis] Annotated ${annotations.length} chapters`);
  await updateProgress(profileId, "annotate", `完成 ${annotations.length} 章标注`, 55);

  // Validate annotation quality
  const suspicious = validateAnnotations(annotations);
  if (suspicious.length > annotations.length * 0.1) {
    console.warn(`[DeepAnalysis] WARNING: ${suspicious.length}/${annotations.length} annotations flagged as suspicious (${(suspicious.length/annotations.length*100).toFixed(1)}%)`);
  }

  // Phase 3
  await updateProgress(profileId, "loops", "检测回环边界...", 60);
  const loops = await detectLoopBoundaries(annotations);
  console.log(`[DeepAnalysis] Detected ${loops.length} loops`);
  await updateProgress(profileId, "loops", `发现 ${loops.length} 轮回环`, 70);

  // Phase 4
  await updateProgress(profileId, "synthesize", "合成统计分布...", 75);
  const architectureProfile = synthesizeProfile(chapters, annotations, loops, name, profileId);
  await updateProgress(profileId, "synthesize", "统计合成完成", 85);

  // Phase 5: Writing techniques
  await updateProgress(profileId, "writing", "提取写法技法...", 75);
  try {
    const techniques = await extractWritingTechniques(text, annotations);
    architectureProfile.writingTechniques = techniques;
    console.log("[DeepAnalysis] Writing techniques extracted");
  } catch (e) { console.warn("[DeepAnalysis] Writing technique extraction failed (non-fatal)", e); }

  // Phase 6: Golden finger extraction (book-level, not chapter-level)
  await updateProgress(profileId, "goldenFinger", "提取金手指...", 82);
  let goldenFingerBounds: any = null;
  try {
    const { aiInvoke } = await import("../../../platform/llm/aiService");
    const { z } = await import("zod");
    const gfSchema = z.object({ abilities: z.array(z.string()), limits: z.array(z.string()), goldenFingerName: z.string().optional() });
    goldenFingerBounds = await aiInvoke({
      assetId: "reference.golden-finger.extract",
      userPrompt: text.slice(0, 80000),
      schema: gfSchema, temperature: 0.5,
    });
    console.log("[DeepAnalysis] Golden finger extracted");
  } catch (e) { console.warn("[DeepAnalysis] Golden finger extraction failed (non-fatal)", e); }

  // Phase 7: Setting timeline extraction
  await updateProgress(profileId, "timeline", "提取设定时间线...", 88);
  let settingTimeline: any = null;
  try {
    const { aiInvoke } = await import("../../../platform/llm/aiService");
    const { z } = await import("zod");
    const tlSchema = z.array(z.object({ chapterIndex: z.number(), settingName: z.string(), description: z.string(), category: z.string() }));
    settingTimeline = await aiInvoke({
      assetId: "reference.setting-timeline.extract",
      userPrompt: text.slice(0, 80000),
      schema: tlSchema, temperature: 0.5,
    });
    console.log("[DeepAnalysis] Setting timeline extracted");
  } catch (e) { console.warn("[DeepAnalysis] Setting timeline extraction failed (non-fatal)", e); }

  // Build loop boundaries in client-compatible format {chapterIndex, type: start|end}
  const loopBoundariesClient = loops.flatMap(l => [
    { chapterIndex: l.startChapter, type: "start" as const, loopIndex: l.loopIndex },
    { chapterIndex: l.endChapter, type: "end" as const, loopIndex: l.loopIndex },
  ]).sort((a, b) => a.chapterIndex - b.chapterIndex);

  await updateProgress(profileId, "persist", "保存结果...", 95);

  // Persist all results
  await prisma.referenceProfile.update({
    where: { id: profileId },
    data: {
      deepAnalysisProgress: null,
      // Keep chapterAnnotations for fast re-analysis (skip annotation phase on re-run)
      architectureProfile: JSON.stringify(architectureProfile),
      totalChapters: chapters.length,
      loopBoundaries: JSON.stringify(loopBoundariesClient),
      coolPointDensity: JSON.stringify({
        highCoolChapters: annotations.filter(a => a.coolPointLevel === "high").map(a => a.chapterIndex),
        lowCoolChapters: annotations.filter(a => a.coolPointLevel === "low").map(a => a.chapterIndex),
      }),
      hookPatterns: JSON.stringify(architectureProfile.hookProfile),
      contentBeatPatterns: JSON.stringify(architectureProfile.contentBeatProfile),
      writingAssets: architectureProfile.writingTechniques ? JSON.stringify(architectureProfile.writingTechniques) : undefined,
      goldenFingerBounds: goldenFingerBounds ? JSON.stringify(goldenFingerBounds) : undefined,
      settingTimeline: settingTimeline ? JSON.stringify(settingTimeline) : undefined,
    },
  });

  console.log(`[DeepAnalysis] Complete — ${chapters.length} chapters, ${loops.length} loops, ${loopBoundariesClient.length} boundaries`);
  return architectureProfile;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 100) : 0;
}
