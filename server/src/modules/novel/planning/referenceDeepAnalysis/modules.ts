import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import type { ArchitectureProfile, LoopPhase, ChapterTypeDistribution, ChapterLengthStats, CoolPointRecipe, HookProfile, ContentBeatProfile, CharacterSystem, PayoffPatterns, WritingTechniques } from "@one2novel/shared/types/architectureProfile";
import type { ParsedChapter, ChapterAnnotation, LoopNarrative, RhythmProfile, GoldenFingerAnalysis, CraftStats, ExpectationTemplate, PowerSystemResult } from "./index";

// ═══════════════════════════════════════════════════════════
// Module A: Architecture Synthesis
// ═══════════════════════════════════════════════════════════

const LoopDetectionSchema = z.object({ loops: z.array(z.object({ startChapter: z.number(), endChapter: z.number(), triggerHint: z.string() })) });

const LoopNarrativeSchema = z.object({
  coreConflict: z.string(), protagonistChange: z.string(),
  keyEvents: z.array(z.string()), infoRevealed: z.array(z.string()),
  settlementContent: z.string(),
  narrativeFunction: z.enum(["setup","escalation","turn","climax","denouement"]),
  progressionFromPrevious: z.string(),
});

export async function detectAndAnalyzeLoops(
  annotations: ChapterAnnotation[], chapters: ParsedChapter[], text: string,
): Promise<{ boundaries: Array<{ chapterIndex: number; type: "start"|"end"; loopIndex: number }>; narratives: LoopNarrative[] }> {
  if (annotations.length < 10) return { boundaries: [], narratives: [] };

  const climaxChapters = annotations.filter(a => a.chapterType === "climax").map(a => a.chapterIndex);
  const patternSummary = annotations.map(a =>
    `第${a.chapterIndex}章 type=${a.chapterType} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} hook=${a.hookType}`
  ).join("\n");

  const raw = await aiInvoke({
    assetId: "reference.loop.infer", userPrompt: [`根据以下 ${annotations.length} 章的标注数据推断回环起止边界。`,`高潮章位置: ${climaxChapters.join("、")}`, patternSummary.slice(0, 8000)].join("\n"),
    schema: LoopDetectionSchema, temperature: 0.4,
  });

  const loops = raw.loops.map((l, i) => ({ ...l, loopIndex: i + 1 }));
  const boundaries = loops.flatMap(l => [
    { chapterIndex: l.startChapter, type: "start" as const, loopIndex: l.loopIndex },
    { chapterIndex: l.endChapter, type: "end" as const, loopIndex: l.loopIndex },
  ]).sort((a, b) => a.chapterIndex - b.chapterIndex);

  const narratives: LoopNarrative[] = [];
  for (const loop of loops) {
    try {
      const loopAnnotations = annotations.filter(a => a.chapterIndex >= loop.startChapter && a.chapterIndex <= loop.endChapter);
      const annotationSummary = loopAnnotations.map(a =>
        `第${a.chapterIndex}章 type=${a.chapterType} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} beat=${a.contentBeat} hook=${a.hookType}`
      ).join("\n");
      const sampleChapters = [loop.startChapter, Math.round((loop.startChapter+loop.endChapter)/2), loop.endChapter];
      const samples = sampleChapters.map(idx => {
        const ch = chapters.find(c => c.index === idx);
        return ch ? `--- 第${ch.index}章 ${ch.title} ---\n${text.slice(ch.startChar, Math.min(ch.startChar + 3000, ch.endChar)).trim()}` : "";
      }).join("\n\n");
      const r = await aiInvoke({
        assetId: "novel.chapter.review",
        userPrompt: [`分析第${loop.loopIndex}轮回环（第${loop.startChapter}-${loop.endChapter}章）的叙事结构。`,`触发提示：${loop.triggerHint}`,`【章节标注】${annotationSummary.slice(0, 6000)}`,`【章节样本】${samples.slice(0, 9000)}`].join("\n"),
        schema: LoopNarrativeSchema, temperature: 0.5,
      });
      narratives.push({ loopIndex: loop.loopIndex, startChapter: loop.startChapter, endChapter: loop.endChapter, ...r });
    } catch (e) { console.warn(`[Module A] Loop ${loop.loopIndex} narrative failed`, e); }
  }
  return { boundaries, narratives };
}

export function computeRhythmProfile(annotations: ChapterAnnotation[]): RhythmProfile {
  const tensionCurve = annotations.map(a => a.conflictIntensity);
  const climaxIndices = annotations.filter(a => a.chapterType === "climax").map(a => a.chapterIndex);
  const cooldownRuns: number[] = [];
  let currentRun = 0;
  for (const a of annotations) { if (a.chapterType === "cooldown") { currentRun++; } else { if (currentRun > 0) { cooldownRuns.push(currentRun); currentRun = 0; } } }
  if (currentRun > 0) cooldownRuns.push(currentRun);
  const climaxIntervals: number[] = [];
  for (let i = 1; i < climaxIndices.length; i++) climaxIntervals.push(climaxIndices[i] - climaxIndices[i - 1]);
  const avgClimaxInterval = climaxIntervals.length > 0 ? Math.round(climaxIntervals.reduce((a,b)=>a+b,0) / climaxIntervals.length) : 12;
  const avgCooldownLength = cooldownRuns.length > 0 ? Math.round(cooldownRuns.reduce((a,b)=>a+b,0) / cooldownRuns.length) : 1;
  const template = avgClimaxInterval < 10 ? "密集高潮" : avgClimaxInterval > 20 ? "渐进爬坡" : "波浪式";
  const description = climaxIntervals.length > 0 ? `约每 ${avgClimaxInterval} 章一个高潮，冷却段平均 ${avgCooldownLength} 章` : "节奏平稳";
  return { tensionCurve, avgClimaxInterval, avgCooldownLength, tensionCycleLength: avgClimaxInterval + avgCooldownLength, rhythmTemplate: template, rhythmDescription: description };
}

export function synthesizeArchitectureProfile(
  chapters: ParsedChapter[], annotations: ChapterAnnotation[],
  loops: Array<{ startChapter: number; endChapter: number; loopIndex: number }>, name: string, profileId: string,
): ArchitectureProfile {
  const total = annotations.length;
  const typeCounts = { advance: 0, transition: 0, cooldown: 0, climax: 0 };
  for (const a of annotations) typeCounts[a.chapterType]++;
  const ctd: ChapterTypeDistribution = { advance: pct(typeCounts.advance,total), transition: pct(typeCounts.transition,total), cooldown: pct(typeCounts.cooldown,total), climax: pct(typeCounts.climax,total) };
  const lengths = chapters.map(c => c.wordCount).filter(n => n > 0);
  const acl: ChapterLengthStats = loops.length > 0 ? { min: Math.min(...loops.map(l=>l.endChapter-l.startChapter+1)), max: Math.max(...loops.map(l=>l.endChapter-l.startChapter+1)), avg: Math.round(loops.reduce((s,l)=>s+(l.endChapter-l.startChapter+1),0)/loops.length) } : { min:10,max:25,avg:18 };
  const awc: ChapterLengthStats = { min: Math.min(...lengths), max: Math.max(...lengths), avg: Math.round(lengths.reduce((s,l)=>s+l,0)/lengths.length) };
  const coolCounts: Record<string,number> = { collect:0,strategy:0,verify:0,reveal:0,upgrade:0,faceSlap:0 };
  for (const a of annotations) { if (a.coolPointLevel==="high") { const b=a.contentBeat; if(["修炼","赚钱"].includes(b)) coolCounts.collect++; else if(["调查","推理"].includes(b)) coolCounts.strategy++; else if(["显圣"].includes(b)) coolCounts.faceSlap++; else if(["说明"].includes(b)) coolCounts.reveal++; else coolCounts.upgrade++; } }
  const tc = Object.values(coolCounts).reduce((s,n)=>s+n,0)||1;
  const cpr: CoolPointRecipe = { collect:pct(coolCounts.collect,tc), strategy:pct(coolCounts.strategy,tc), verify:pct(coolCounts.verify,tc), reveal:pct(coolCounts.reveal,tc), upgrade:pct(coolCounts.upgrade,tc), faceSlap:pct(coolCounts.faceSlap,tc) };
  const hookCounts = { suspense:0,reversal:0,preview:0,emotional:0 };
  for (const a of annotations) hookCounts[a.hookType]++;
  const th = Object.values(hookCounts).reduce((s,n)=>s+n,0)||1;
  const hp: HookProfile = { shortTermPerChapter: Math.round((hookCounts.suspense+hookCounts.reversal)/total*10)/10||1, mediumTermPerVolume: Math.max(1,Math.round(loops.length/Math.max(1,(total/100))*10)/10||3), longTermLines: Math.max(1,Math.round(total/100)||4), hookDistribution: { suspense:pct(hookCounts.suspense,th), reversal:pct(hookCounts.reversal,th), preview:pct(hookCounts.preview,th), emotional:pct(hookCounts.emotional,th) } };
  const beatCounts: Record<string,number> = {};
  for (const a of annotations) { beatCounts[a.contentBeat]=(beatCounts[a.contentBeat]||0)+1; if(a.secondaryBeat) beatCounts[a.secondaryBeat]=(beatCounts[a.secondaryBeat]||0)+0.5; }
  const tb = Object.values(beatCounts).reduce((s,n)=>s+n,0)||1;
  const cbp: ContentBeatProfile = {}; for (const [k,c] of Object.entries(beatCounts)) cbp[k]=Math.round(c/tb*100);
  const avgConflict = annotations.reduce((s,a)=>s+a.conflictIntensity,0)/total;
  const cs: CharacterSystem = { avgTotal: Math.round(8+avgConflict*1.5), roleDistribution:{protagonist:1,antagonist:Math.round(2+avgConflict/5),supporting:Math.round(3+avgConflict/3),minor:Math.round(2+avgConflict/3)}, avgChaptersBetweenAppearances: Math.round(total/15), avgCharactersPerChapter: Math.round(2+avgConflict/3) };
  const pp: PayoffPatterns = { avgSeedToPayoffChapters: loops.length>0?Math.round(total/loops.length*0.7):50, seedsPerVolume: Math.max(2,Math.round(total/20)), typicalPayoffWindow: loops.length>0?Math.round(total/loops.length):50 };
  const lp: LoopPhase[] = [
    { phase:"trigger",label:"触发事件",description:"新副本/任务/危机的引入",typicalChapterRange:[1,3]},
    { phase:"enter",label:"进入探索",description:"进入新环境，收集线索和资源",typicalChapterRange:[2,5]},
    { phase:"explore",label:"深入展开",description:"副本内部展开，推进核心探索",typicalChapterRange:[3,6]},
    { phase:"setback",label:"受挫考验",description:"遭遇重大阻碍或失败",typicalChapterRange:[1,3]},
    { phase:"turn",label:"转折翻盘",description:"利用资源/信息实现逆转",typicalChapterRange:[1,3]},
    { phase:"climax",label:"决战高潮",description:"与最大威胁的最终对抗",typicalChapterRange:[1,2]},
    { phase:"settlement",label:"结算收获",description:"成果盘点，暗示下一轮方向",typicalChapterRange:[1,2]},
  ];
  return { name, source:"reference", sourceReferenceProfileId: profileId, loopPhases:lp, chapterTypeDistribution:ctd, avgChaptersPerLoop:acl, avgChapterWordCount:awc, coolPointRecipe:cpr, hookProfile:hp, contentBeatProfile:cbp, characterSystem:cs, payoffPatterns:pp };
}

// ═══════════════════════════════════════════════════════════
// Module B: Power System Extraction (AI)
// ═══════════════════════════════════════════════════════════

const PowerSystemSchema = z.object({
  levels: z.array(z.object({
    name: z.string(), breakthroughCondition: z.string(), abilityUpgrade: z.string(),
    typicalChapterRange: z.string().optional(), expectationType: z.string().optional(), children: z.array(z.any()).default([]),
  })),
});

export async function extractPowerSystem(annotations: ChapterAnnotation[], text: string): Promise<PowerSystemResult | null> {
  const cultivationChapters = annotations.filter(a => a.contentBeat === "修炼" || a.contentBeat === "突破" || a.contentBeat === "战斗");
  if (cultivationChapters.length < 3) return null;

  const summary = cultivationChapters.slice(0, 40).map(a =>
    `第${a.chapterIndex}章 type=${a.chapterType} beat=${a.contentBeat} cool=${a.coolPointLevel} conflict=${a.conflictIntensity} summary=${a.summary}`
  ).join("\n");

  try {
    const raw = await aiInvoke({
      assetId: "novel.power-system.generate",
      userPrompt: [`从以下章节标注推断力量体系结构：\n${summary.slice(0, 6000)}\n\n【参考书内容样本】\n${text.slice(0, 30000)}`].join("\n"),
      schema: PowerSystemSchema, temperature: 0.5,
    });
    const expectationNodes = raw.levels.map(l => ({
      name: l.name, expectation: l.expectationType || (l.abilityUpgrade ? `获得新能力：${l.abilityUpgrade.slice(0, 30)}` : "境界突破"),
    }));
    return { tree: raw.levels, expectationNodes };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// Module C: Golden Finger Analysis (AI)
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

export async function extractGoldenFinger(text: string, annotations: ChapterAnnotation[]): Promise<GoldenFingerAnalysis | null> {
  try {
    const raw = await aiInvoke({
      assetId: "reference.golden-finger.extract",
      userPrompt: [text.slice(0, 80000), "提取金手指后，分析其设计模式。",].join("\n"),
      schema: GoldenFingerSchema, temperature: 0.5,
    });
    // Evolution timeline from annotation matrix
    const evolutionTimeline: Array<{chapter: number; ability: string; trigger: string}> = [];
    for (const a of annotations) {
      if (a.coolPointLevel === "high" && (a.contentBeat === "修炼" || a.contentBeat === "显圣")) {
        evolutionTimeline.push({ chapter: a.chapterIndex, ability: a.summary.slice(0, 30), trigger: a.chapterType === "climax" ? "决战突破" : "常规获得" });
      }
    }
    return { ...raw, evolutionTimeline: evolutionTimeline.slice(0, 10) };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// Module D: Writing Craft + Expectation Chain
// ═══════════════════════════════════════════════════════════

const WritingExtractSchema = z.object({
  overallStyleDescription: z.string(),
  narrativeAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  languageAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  characterAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  rhythmAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
  antiAiAssets: z.array(z.object({ category: z.string(), observation: z.string(), rule: z.string(), confidence: z.number() })),
});

export async function extractWritingTechniques(text: string, annotations: ChapterAnnotation[]): Promise<WritingTechniques | null> {
  try {
    const findChapter = (type: string): string => {
      const match = annotations.find(a => a.chapterType === type || a.contentBeat === type);
      if (!match) return text.slice(0, 3000);
      const pattern = new RegExp(`第${match.chapterIndex}[章節节回].*?(?=第\\d+[章節节回]|$)`, "s");
      const found = text.match(pattern);
      return found ? found[0].slice(0, 3000) : text.slice(0, 3000);
    };
    const samples = [`【高潮场景】\n${findChapter("climax")}`, `【日常场景】\n${findChapter("cooldown")}`, `【推进场景】\n${findChapter("advance")}`].join("\n\n");
    return await aiInvoke({ assetId: "reference.writing_assets.extract", userPrompt: samples.slice(0, 12000), schema: WritingExtractSchema, temperature: 0.5 });
  } catch { return null; }
}

export function computeCraftStats(annotations: ChapterAnnotation[]): CraftStats {
  const openingPatterns: Record<string, number> = {};
  for (const a of annotations) openingPatterns[a.openingType] = (openingPatterns[a.openingType] || 0) + 1;
  const entries = Object.entries(openingPatterns).sort(([,a],[,b]) => b - a);
  const dominantOpening = entries.length > 0 ? entries[0][0] : "unknown";
  return { openingPatterns, dominantOpening, dialogueRatio: 0, avgDialoguePerChapter: 0, avgDialogueLineLength: 0, descriptionDistribution: {} };
}

const ExpectationSchema = z.object({
  expectations: z.array(z.object({
    loopIndex: z.number(), expectationType: z.string(), establishmentChapter: z.number(), establishmentMethod: z.string(), maintenanceMethod: z.string(), fulfillmentChapter: z.number(), fulfillmentMethod: z.string(), nextExpectation: z.string(),
  })),
});

export async function extractExpectationChains(annotations: ChapterAnnotation[], loopNarratives: LoopNarrative[]): Promise<ExpectationTemplate[]> {
  if (loopNarratives.length === 0) return [];
  try {
    const loopSummary = loopNarratives.map(l => {
      const loopAnnotations = annotations.filter(a => a.chapterIndex >= l.startChapter && a.chapterIndex <= l.endChapter);
      const hookDist = { suspense: 0, reversal: 0, preview: 0, emotional: 0 };
      for (const a of loopAnnotations) hookDist[a.hookType]++;
      const beatDist: Record<string, number> = {};
      for (const a of loopAnnotations) beatDist[a.contentBeat] = (beatDist[a.contentBeat] || 0) + 1;
      return `Loop ${l.loopIndex} (ch${l.startChapter}-${l.endChapter}): conflict="${l.coreConflict.slice(0, 50)}" hooks=s:${hookDist.suspense}/r:${hookDist.reversal}/p:${hookDist.preview}/e:${hookDist.emotional} topBeats=${Object.entries(beatDist).sort(([,a],[,b])=>b-a).slice(0,3).map(([k,v])=>`${k}:${v}`).join(",")}`;
    }).join("\n");
    const raw = await aiInvoke({
      assetId: "novel.expectation-chain.extract",
      userPrompt: loopSummary.slice(0, 6000),
      schema: ExpectationSchema, temperature: 0.5,
    });
    return raw.expectations;
  } catch { return []; }
}

function pct(count: number, total: number): number { return total > 0 ? Math.round(count / total * 100) : 0; }
