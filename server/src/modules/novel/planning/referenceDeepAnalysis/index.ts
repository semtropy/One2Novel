import { getPrisma } from "../../../../platform/db/client";
import type { ArchitectureProfile, WritingTechniques } from "@one2novel/shared/types/architectureProfile";
import { parseChapters } from "./parse";
import { batchAnnotateChapters } from "./annotate";
import {
  detectAndAnalyzeLoops, computeRhythmProfile, synthesizeArchitectureProfile,
  extractPowerSystem, extractGoldenFinger,
  extractWritingTechniques, computeCraftStats, extractExpectationChains,
} from "./modules";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ParsedChapter { index: number; title: string; startChar: number; endChar: number; wordCount: number; }

export interface ChapterAnnotation {
  chapterIndex: number;
  chapterType: "advance" | "transition" | "cooldown" | "climax";
  coolPointLevel: "high" | "medium" | "low";
  hookType: "suspense" | "reversal" | "preview" | "emotional";
  contentBeat: string; secondaryBeat?: string;
  conflictIntensity: number;
  openingType: "action" | "dialogue" | "environment" | "internal" | "exposition";
  summary: string;
  exemplarOpening?: string; exemplarEnding?: string;
}

export interface LoopNarrative {
  loopIndex: number; startChapter: number; endChapter: number;
  coreConflict: string; protagonistChange: string;
  keyEvents: string[]; infoRevealed: string[];
  settlementContent: string;
  narrativeFunction: "setup" | "escalation" | "turn" | "climax" | "denouement";
  progressionFromPrevious: string;
}

export interface RhythmProfile {
  tensionCurve: number[]; avgClimaxInterval: number; avgCooldownLength: number;
  tensionCycleLength: number; rhythmTemplate: string; rhythmDescription: string;
}

export interface GoldenFingerAnalysis {
  name: string; abilities: string[]; limits: string[];
  designPattern: { type: string; typeDescription: string; coreMechanic: string; acquisitionPattern: string; evolutionPath: string[]; limitationStrategy: string; narrativeIntegration: string; suitability: { genres: string[]; architectures: string[] } };
  evolutionTimeline: Array<{ chapter: number; ability: string; trigger: string }>;
}

export interface CraftStats {
  openingPatterns: Record<string, number>; dominantOpening: string;
  dialogueRatio: number; avgDialoguePerChapter: number; avgDialogueLineLength: number;
  descriptionDistribution: Record<string, number>;
}

export interface ExpectationTemplate {
  loopIndex: number; expectationType: string;
  establishmentChapter: number; establishmentMethod: string;
  maintenanceMethod: string; fulfillmentChapter: number;
  fulfillmentMethod: string; nextExpectation: string;
}

export interface PowerSystemResult {
  tree: Array<{ name: string; breakthroughCondition: string; abilityUpgrade: string; children: any[] }>;
  expectationNodes: Array<{ name: string; expectation: string }>;
}

export interface AnalysisResultV3 {
  totalChapters: number; completedAt: string;
  annotations: ChapterAnnotation[];
  architecture: {
    loopBoundaries: Array<{ chapterIndex: number; type: "start" | "end"; loopIndex: number }>;
    loopNarratives: LoopNarrative[];
    rhythmProfile: RhythmProfile;
    architectureProfile: ArchitectureProfile;
  };
  powerSystem: PowerSystemResult | null;
  goldenFinger: GoldenFingerAnalysis | null;
  writing: {
    techniques: WritingTechniques | null;
    craftStats: CraftStats;
    expectations: ExpectationTemplate[];
  };
}

// ═══════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════

async function updateProgress(profileId: string, phase: string, detail: string, pct: number) {
  try { await getPrisma().referenceProfile.update({ where: { id: profileId }, data: { deepAnalysisProgress: JSON.stringify({ phase, detail, pct }) } }); } catch {}
}

export async function deepAnalyze(profileId: string): Promise<AnalysisResultV3> {
  const prisma = getPrisma();
  const profile = await prisma.referenceProfile.findUnique({ where: { id: profileId } });
  if (!profile?.content) throw new Error("Profile has no content");
  let text = profile.content;
  const name = profile.name || "未命名参考书";
  console.log(`[DeepAnalysis] Starting "${name}" (${text.length} chars)`);

  // Phase 1: Parse
  await updateProgress(profileId, "parse", "解析章节目录...", 5);
  let chapters: ParsedChapter[];
  if (text.startsWith("[") && text.includes('"title"') && text.includes('"content"')) {
    const rawChapters = JSON.parse(text) as { title: string; content: string }[];
    let pos = 0;
    chapters = rawChapters.map((c, i) => { const start = pos; pos += c.content.length + 2; return { index: i + 1, title: c.title, startChar: start, endChar: pos, wordCount: c.content.length }; });
    text = rawChapters.map(c => c.content).join("\n\n");
  } else { chapters = parseChapters(text); }
  console.log(`[DeepAnalysis] ${chapters.length} chapters`);
  await updateProgress(profileId, "parse", `${chapters.length} 章`, 8);

  // Phase 2: Annotate
  const totalBatchesEst = Math.ceil(chapters.length / 15);
  await updateProgress(profileId, "annotate", `标注章节 (0/${totalBatchesEst} 批)...`, 10);
  const annotations = await batchAnnotateChapters(chapters, text, profileId, async (batch, total) => {
    await updateProgress(profileId, "annotate", `标注章节 (${batch}/${total} 批)`, 10 + Math.round(batch / total * 40));
  });
  console.log(`[DeepAnalysis] ${annotations.length} annotations`);
  await updateProgress(profileId, "annotate", `${annotations.length} 章标注完成`, 50);

  // Module A: Architecture
  await updateProgress(profileId, "arch", "回环检测 + 叙事分析...", 52);
  const { boundaries, narratives } = await detectAndAnalyzeLoops(annotations, chapters, text);
  const rhythmProfile = computeRhythmProfile(annotations);
  const loops = narratives.map(n => ({ startChapter: n.startChapter, endChapter: n.endChapter, loopIndex: n.loopIndex }));
  const architectureProfile = synthesizeArchitectureProfile(chapters, annotations, loops, name, profileId);
  console.log(`[Module A] ${narratives.length} loops, rhythm=${rhythmProfile.rhythmTemplate}`);
  await updateProgress(profileId, "arch", `${narratives.length} 轮回环分析完成`, 68);

  // Module B: Power System (may fail, non-blocking)
  await updateProgress(profileId, "power", "力量体系提取...", 70);
  let powerSystem: PowerSystemResult | null = null;
  try { powerSystem = await extractPowerSystem(annotations, text); console.log(`[Module B] Power system: ${powerSystem?.expectationNodes.length ?? 0} levels`); } catch (e) { console.warn("[Module B] Failed", e); }
  await updateProgress(profileId, "power", "力量体系完成", 75);

  // Module C: Golden Finger (may fail, non-blocking)
  await updateProgress(profileId, "gf", "金手指 + 进化时间线...", 78);
  let goldenFinger: GoldenFingerAnalysis | null = null;
  try { goldenFinger = await extractGoldenFinger(text, annotations); console.log(`[Module C] GF: ${goldenFinger?.name ?? "none"} timeline=${goldenFinger?.evolutionTimeline.length ?? 0}`); } catch (e) { console.warn("[Module C] Failed", e); }
  await updateProgress(profileId, "gf", "金手指完成", 83);

  // Module D: Writing + Expectations
  await updateProgress(profileId, "writing", "写法技法 + 期待链...", 85);
  const techniques = await extractWritingTechniques(text, annotations);
  if (techniques) architectureProfile.writingTechniques = techniques;
  const craftStats = computeCraftStats(annotations, text);
  const expectations = await extractExpectationChains(annotations, narratives);
  console.log(`[Module D] Writing: ${techniques ? "done" : "failed"}, craftStats: ${craftStats.dominantOpening}, expectations: ${expectations.length}`);
  await updateProgress(profileId, "writing", "写作分析完成", 95);

  // Assemble + Persist
  const result: AnalysisResultV3 = {
    totalChapters: chapters.length, completedAt: new Date().toISOString(), annotations,
    architecture: { loopBoundaries: boundaries, loopNarratives: narratives, rhythmProfile, architectureProfile },
    powerSystem, goldenFinger,
    writing: { techniques, craftStats, expectations },
  };

  await updateProgress(profileId, "persist", "保存...", 97);
  await prisma.referenceProfile.update({
    where: { id: profileId },
    data: { deepAnalysisProgress: null, analysisResult: JSON.stringify(result) },
  });

  console.log(`[DeepAnalysis] Complete — ${chapters.length} chapters, ${narratives.length} loops`);
  return result;
}
