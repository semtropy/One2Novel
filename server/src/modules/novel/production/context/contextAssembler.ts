/**
 * ContextAssembler — deep module for chapter context assembly.
 *
 * Interface: one function, one return type.
 * Implementation: absorbs 12+ module dependencies behind a single seam.
 *
 * This module is the central nervous system of chapter generation.
 * Every chapter write (manual, director batch, preview) crosses its seam.
 *
 * Before: assembleChapterBlocks() in contextBlockBuilders.ts had 12+
 *   module imports at the top — the interface was as wide as the implementation.
 * After:  all cross-module dependencies are internal. Callers and tests
 *   exercise one function. Depth = high leverage.
 */

import { getPrisma } from "../../../../platform/db/client";
import { createNovelRepo, type NovelRepo } from "../../../../platform/data/repositories";
import { createContextBlock } from "../../../../platform/llm/contextSelection";
import type { PromptContextBlock } from "../../../../platform/llm/promptTypes";

// ── Internal imports — all behind the seam ──

import { resolveStyleContext } from "../../../style/styleRuntimeResolver";
import { selectRelevantRules, activateRulesForChapter, getActiveRulesContext } from "../../world/ruleActivationService";
import { getActiveConflicts } from "../openConflict";
import { getTimelineContext } from "../../../timeline/timelineService";
import { compileScenePlanContext } from "./scenePlanService";
import { generateChapterDynamics, compileDynamicsContext } from "../../planning/characterPrep/characterDynamicsService";
import { getActivePayoffContext } from "../../../payoff/payoffService";
import { buildLiveFraming, buildLiveCharacters } from "../characterFormatting";
import { buildTieredContext } from "./tieredCompressionService";
import { buildCharacterProhibitions, type CharacterProhibition } from "../quality/characterProhibitions";
import { buildRagContextBlock } from "./ragContextBuilder";
import { buildEntityLifecycleBlock, compileEntityLifecycleContent } from "../post/entityLifecycle";
import { buildCurrentVolumeContext } from "./volumeCompressor";
import { buildMemoryPack, compileMemoryPackContent } from "../post/memoryOrchestrator";

// Content guides (extracted to keep this file focused on assembly logic)
import { getLoopPhaseGuide, buildReferenceStyleHints, buildReferenceCounterpart, getContentBeatGuide } from "./contentGuides";

// ─── Shared DB fetch (exported for backward compat) ──────────────

export async function fetchAssemblyBase(novelId: string, chapterId: string, novelRepo?: NovelRepo) {
  const repo = novelRepo ?? createNovelRepo(getPrisma());
  const novel = await repo.findAssemblyBase(novelId);
  if (!novel) throw new Error("Novel not found");

  const chapter = novel.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const prevChapters = novel.chapters.filter((c) => c.order < chapter.order);
  const lastChapter = prevChapters[prevChapters.length - 1] ?? null;

  return { novel, chapter, prevChapters, lastChapter };
}

// ─── Block assembly — one interface, deep implementation ───

/**
 * Assemble all context blocks for a chapter.
 *
 * This is the module's sole public interface. Callers pass two IDs;
 * the implementation crosses 12+ internal seams to gather style,
 * world rules, timeline, characters, payoffs, conflicts, RAG,
 * tiered compression, entity lifecycle, dynamics, and reference data.
 */
export async function assembleChapterBlocks(
  novelId: string,
  chapterId: string,
): Promise<PromptContextBlock[]> {
  const { novel, chapter, prevChapters, lastChapter } = await fetchAssemblyBase(novelId, chapterId);
  const prisma = getPrisma();
  const repo = createNovelRepo(prisma);

  const blocks: PromptContextBlock[] = [];

  // ── book_contract ──
  const storyCoreContent = [
    novel.storySummary ? `故事简介：${novel.storySummary}` : null,
    novel.centralQuestion ? `核心悬念：${novel.centralQuestion}` : null,
    novel.endingDirection ? `结局方向：${novel.endingDirection}` : null,
    novel.targetAudience ? `目标读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `核心卖点：${novel.bookSellingPoint}` : null,
    novel.competingFeel ? `差异化：${novel.competingFeel}` : null,
    novel.first30ChapterPromise ? `前30章承诺：${novel.first30ChapterPromise}` : null,
  ].filter(Boolean).join("\n");
  if (storyCoreContent) {
    blocks.push(createContextBlock({
      id: "book_contract", group: "book_contract", priority: 104, required: true,
      instructionHeader: "【本书合约 — 以下设定和方向为本创作会话的基础契约，本章必须在这些约束内创作】",
      content: storyCoreContent, conflictGroup: "book_contract", freshness: 2,
    }));
  }
  const liveFraming = buildLiveFraming(novel);
  if (liveFraming) {
    blocks.push(createContextBlock({
      id: "book_contract_live", group: "book_contract", priority: 103, required: false,
      content: liveFraming, conflictGroup: "book_contract", freshness: 1,
    }));
  }

  // ── chapter_mission ──
  const chapterPlan = await prisma.volumeChapterPlan.findFirst({
    where: { chapterId },
    select: { purpose: true, exclusiveEvent: true, endingState: true, mustAvoid: true, chapterOrder: true, summary: true, loopPhase: true, chapterType: true, coolPointType: true, contentBeat: true, volume: { select: { title: true, summary: true } } },
  });
  const missionParts = [`本章任务：${chapter.expectation ?? "推进主线"}`];
  if (chapterPlan?.purpose) missionParts.push(`核心目的：${chapterPlan.purpose}`);
  if (chapterPlan?.exclusiveEvent) missionParts.push(`独占事件：${chapterPlan.exclusiveEvent}`);
  if (chapterPlan?.endingState) missionParts.push(`结束状态：${chapterPlan.endingState}`);
  if (chapterPlan?.mustAvoid) missionParts.push(`必须避免：${chapterPlan.mustAvoid}`);
  if (chapterPlan?.loopPhase) {
    const phaseGuide = getLoopPhaseGuide(chapterPlan.loopPhase, chapterPlan.chapterType, chapterPlan.coolPointType);
    if (phaseGuide) missionParts.push(`[回环阶段指引] ${phaseGuide}`);
  }
  blocks.push(createContextBlock({
    id: "chapter_mission", group: "chapter_mission", priority: 100, required: true,
    content: missionParts.join("\n"),
  }));

  // ── previous_chapter_hook ──
  if (lastChapter?.content) {
    blocks.push(createContextBlock({
      id: "previous_chapter_hook", group: "previous_chapter_hook", priority: 100, required: true,
      instructionHeader: "【上一章完整内容 — 仅供连续性参考。本章开头必须直接进入新情境，不得复述或引用原文。】",
      content: `${lastChapter.title ? `标题：${lastChapter.title}\n` : ""}${lastChapter.content}`,
    }));
  }

  // ── character_hard_facts ──
  const liveChars = buildLiveCharacters(novel);
  if (liveChars) {
    blocks.push(createContextBlock({
      id: "character_hard_facts", group: "character_hard_facts", priority: 99, required: true,
      instructionHeader: "【人物硬事实 — 以下角色状态为不可违背的硬约束。角色行为必须符合此处的性格、目标和状态，不得自行改变。】",
      content: liveChars, conflictGroup: "character_hard_facts", freshness: 1,
    }));
  }

  // ── entity_lifecycle ──
  try {
    const lifecycleEntries = await buildEntityLifecycleBlock(novelId);
    const lifecycleContent = compileEntityLifecycleContent(lifecycleEntries);
    if (lifecycleContent) {
      blocks.push(createContextBlock({
        id: "entity_lifecycle", group: "character_hard_facts", priority: 95, required: true,
        content: lifecycleContent, conflictGroup: "character_hard_facts", freshness: 1,
      }));
    }
  } catch { /* best-effort */ }

  // ── semantic_memory (write-after沉淀, write-before injection) ──
  try {
    const novelOrder = chapter.order;
    const pack = await buildMemoryPack(novelId, novelOrder);
    if (pack) {
      const content = compileMemoryPackContent(pack);
      if (content) {
        blocks.push(createContextBlock({
          id: "semantic_memory", group: "semantic_memory", priority: 92,
          content,
          freshness: 1,
        }));
      }
    }
  } catch { /* best-effort */ }

  // ── character_dynamics ──
  try {
    const dynamics = await generateChapterDynamics(novelId, chapterId);
    const dynamicsContent = compileDynamicsContext(dynamics);
    if (dynamicsContent) {
      blocks.push(createContextBlock({
        id: "character_dynamics", group: "character_dynamics", priority: 97,
        content: dynamicsContent,
      }));
    }
  } catch { /* best-effort */ }

  // ── style_contract ──
  const styleCtx = await resolveStyleContext(novelId, chapter.id);
  if (styleCtx.styleBlock) {
    blocks.push(createContextBlock({
      id: "style_contract", group: "style_contract", priority: 74, required: true,
      content: styleCtx.styleBlock,
    }));
  }
  if (styleCtx.antiAiPrompt) {
    blocks.push(createContextBlock({
      id: "opening_constraints", group: "opening_constraints", priority: 80,
      content: styleCtx.antiAiPrompt,
    }));
  }

  // ── reference_counterpart ──
  try {
    const refCounterpart = await buildReferenceCounterpart(novelId, chapter.order);
    if (refCounterpart) {
      blocks.push(createContextBlock({
        id: "reference_counterpart",
        group: "style_contract",
        priority: 85,
        required: false,
        content: refCounterpart,
      }));
    }
  } catch { /* best-effort */ }

  // ── payoff_directives ──
  const payoffContext = await getActivePayoffContext(novelId, chapter.order);
  if (payoffContext) {
    blocks.push(createContextBlock({
      id: "payoff_directives", group: "payoff_directives", priority: 98,
      content: payoffContext,
    }));
  }

  // ── story_macro ──
  if (chapterPlan) {
    const volTitle = chapterPlan.volume?.title ?? "";
    const volSummary = chapterPlan.volume?.summary ?? "";
    const mission = chapter.expectation ?? chapterPlan.summary ?? "推进主线";
    blocks.push(createContextBlock({
      id: "story_macro", group: "story_macro", priority: 98, required: true,
      instructionHeader: `【卷级导向 — 本章必须在"'${volTitle}'"的方向上取得具体进展】`,
      content: `当前卷概要：${volSummary}\n本章（卷内第${chapterPlan.chapterOrder}章）目标：${mission}`,
    }));
  } else {
    blocks.push(createContextBlock({
      id: "story_macro", group: "story_macro", priority: 98, required: true,
      instructionHeader: "【本章目标 — 本章必须在以下目标上取得实质进展】",
      content: `本章目标：${chapter.expectation ?? "推进主线"}`,
    }));
  }

  // ── open_conflicts ──
  const openConflicts = await getActiveConflicts(novelId);
  if (openConflicts) {
    blocks.push(createContextBlock({
      id: "open_conflicts", group: "open_conflicts", priority: 88,
      instructionHeader: "【开放冲突 — 以下冲突必须在本章中被处理。每个冲突或升级、或解决、或至少让读者感受到其存在。】",
      content: openConflicts,
    }));
  }

  // ── rag_semantic_context ──
  try {
    const ragBlock = await buildRagContextBlock(
      novelId, chapter.order, chapter.expectation,
      chapter.title, chapterPlan?.purpose ?? "",
      {
        contentBeat: chapterPlan?.contentBeat ?? null,
        loopPhase: chapterPlan?.loopPhase ?? null,
        coolPointType: chapterPlan?.coolPointType ?? null,
        chapterType: chapterPlan?.chapterType ?? null,
      },
    );
    if (ragBlock) blocks.push(ragBlock);
  } catch { /* best-effort */ }

  // ── rag_backtrack_context（摘要→场景联动） ──
  try {
    const { buildRagBacktrackBlock } = await import("./ragContextBuilder");
    const btBlock = await buildRagBacktrackBlock(
      novelId, chapter.order, chapter.expectation,
      chapter.title, chapterPlan?.purpose ?? "",
    );
    if (btBlock) blocks.push(btBlock);
  } catch { /* best-effort */ }

  // ── recent_chapters (tiered or raw) ──
  if (prevChapters.length > 3) {
    try {
      const tiered = await buildTieredContext(novelId, chapter.order);
      if (tiered.tier1Adjacent) {
        blocks.push(createContextBlock({
          id: "recent_chapters", group: "recent_chapters", priority: 86,
          content: tiered.tier1Adjacent,
        }));
      }
      if (tiered.tier2Recent) {
        blocks.push(createContextBlock({
          id: "recent_skeleton", group: "recent_chapters", priority: 80,
          content: tiered.tier2Recent,
        }));
      }
      if (tiered.tier3VolumeSummary) {
        blocks.push(createContextBlock({
          id: "volume_summary", group: "volume_window", priority: 82,
          content: tiered.tier3VolumeSummary,
        }));
      }
      if (tiered.tier4Archive) {
        blocks.push(createContextBlock({
          id: "volume_archive", group: "story_macro", priority: 75,
          content: tiered.tier4Archive,
        }));
      }
    } catch { /* fall through */ }
  } else {
    const recentContent = prevChapters.slice(-5).map((c) => {
      const excerpt = c.content?.slice(0, 200)?.replace(/<[^>]*>/g, "") ?? "";
      return `第${c.order}章 ${c.title}：${c.expectation ?? ""}${excerpt ? `\n  节选：${excerpt}...` : ""}`;
    }).join("\n\n");
    if (recentContent) {
      blocks.push(createContextBlock({
        id: "recent_chapters", group: "recent_chapters", priority: 86,
        content: recentContent,
      }));
    }
  }

  // ── current_volume_context ──
  try {
    const volContext = await buildCurrentVolumeContext(novelId, chapter.order);
    if (volContext) {
      blocks.push(createContextBlock({
        id: "current_volume_context", group: "volume_window", priority: 80,
        content: volContext,
      }));
    }
  } catch { /* best-effort */ }

  // ── timeline ──
  const timelineContext = await getTimelineContext(novelId, chapter.order);
  if (timelineContext) {
    blocks.push(createContextBlock({
      id: "timeline", group: "recent_chapters", priority: 85,
      content: timelineContext,
    }));
  }

  // ── world_rules ──
  const chapterContextForActivation = [
    chapter.expectation ?? "", chapter.title ?? "",
    chapterPlan?.volume?.summary ?? "", liveChars ?? "",
  ].join(" ");
  const relevantRules = await selectRelevantRules(novelId, chapterContextForActivation);
  activateRulesForChapter(novelId, chapter.id, chapterContextForActivation).catch(() => {});
  const worldRules = getActiveRulesContext(relevantRules);
  if (worldRules) {
    blocks.push(createContextBlock({
      id: "world_rules", group: "story_macro", priority: 90,
      content: worldRules,
    }));
  }

  // ── expectation_profile ──
  try {
    const ep = await repo.getExpectationProfile(novelId);
    if (ep) {
      const parts: string[] = [];
      if (ep.coolPointRecipe) {
        const recipe = ep.coolPointRecipe as Record<string, number>;
        const sorted = Object.entries(recipe).sort((a, b) => b[1] - a[1]);
        const top2 = sorted.slice(0, 2).map(([t]) => ({collect:"收集型爽点（获取资源/装备/能力）",strategy:"策略型爽点（用智慧解决问题）",verify:"验证型爽点（检验新能力）",reveal:"揭示型爽点（揭晓真相/秘密）",upgrade:"升级型爽点（境界突破/能力跃迁）",face_slap:"打脸型爽点（碾压对手/震惊众人）"}[t] ?? t));
        parts.push(`【爽点要求】本章优先安排：${top2.join("、")}。避免连续两章使用相同类型爽点。`);
        const lowTypes = sorted.slice(-2).map(([t, pct]) => ({t, pct}));
        if (lowTypes[0]?.pct <= 10) {
          parts.push(`注意：${({collect:"收集",strategy:"策略",verify:"验证",reveal:"揭示",upgrade:"升级",face_slap:"打脸"}[lowTypes[0].t] ?? lowTypes[0].t)}型爽点已多章未出现，如本章合适可适当补入。`);
        }
      }
      if (ep.hookProfile) {
        parts.push(`【钩子要求】本章必须设置${ep.hookProfile.shortTermPerChapter}个短期钩子（章尾必须留下悬念），并推进${ep.hookProfile.longTermPerVolume}条长期线索中的至少1条。钩子类型优先使用悬念型或反转型，避免预告型。`);
      }
      if (ep.payoffWindow) parts.push(`【伏笔窗口】检查已有伏笔，如有第${ep.payoffWindow}章前埋下的伏笔处于回收窗口内，必须在本章兑现或显著推进。`);
      if (parts.length > 0) {
        blocks.push(createContextBlock({
          id: "expectation_profile", group: "chapter_mission", priority: 95,
          content: parts.join("\n"),
        }));
      }
    }
  } catch { /* best-effort */ }

  // ── writing_techniques ──
  try {
    const ap = await repo.getArchitectureProfile(novelId);
    let styleContent = "";

    if (ap?.writingTechniques?.overallStyleDescription) {
      const wt = ap.writingTechniques;
      const lines = ["【写作风格要求 — 以下规则来自对标书分析，本章必须遵循】"];
      const cats = [
        { key: "narrativeAssets" as const, label: "叙事技法要求" },
        { key: "languageAssets" as const, label: "语言风格要求" },
        { key: "characterAssets" as const, label: "角色塑造要求" },
        { key: "rhythmAssets" as const, label: "节奏控制要求" },
        { key: "antiAiAssets" as const, label: "反AI特征要求" },
      ];
      for (const { key, label } of cats) {
        const techniques = (wt[key] as Array<{ rule: string }> | undefined) ?? [];
        if (techniques.length > 0) {
          lines.push(`\n【${label}】${techniques.map((t: { rule: string }) => t.rule).join("。")}`);
        }
      }
      styleContent = lines.join("\n");
    }

    if (!styleContent) {
      const refStyleHints = await buildReferenceStyleHints(novelId).catch(() => null);
      if (refStyleHints) styleContent = `【写作风格参考 — 以下规则来自对标书分析】\n${refStyleHints}`;
    }

    if (styleContent) {
      blocks.push(createContextBlock({
        id: "writing_techniques", group: "style_contract", priority: 76,
        content: styleContent, conflictGroup: "style_contract", freshness: 1,
      }));
    }

    // Craft stats
    if (ap?.craftStats) {
      const cs = ap.craftStats;
      const craftLines: string[] = [];
      const MAX_GUIDES: Record<string, string> = {
        action: "本章应以动作开场，直接进入冲突，避免环境描写或背景铺垫开头",
        dialogue: "本章应以对话开场，用角色对话带入情境，避免叙述性铺垫",
        environment: "本章应以环境描写开场，但控制在2-3句内，迅速转入剧情",
        internal: "本章应以内心独白开场，用角色思绪带入当前困境",
        exposition: "本章以说明性文字开场，但必须通过具体场景呈现，避免纯科普段落",
      };
      if (cs.dominantOpening) {
        craftLines.push(`【开场方式】${MAX_GUIDES[cs.dominantOpening] ?? `优先使用${cs.dominantOpening}方式开场，避免其他开场方式`}`);
      }
      if (cs.dialogueRatio) {
        const r = cs.dialogueRatio;
        if (r >= 40) craftLines.push(`【对话要求】对标书对话密集（约${r}%），本章应主要通过对话推进剧情，对话应占显著篇幅`);
        else if (r >= 25) craftLines.push(`【对话要求】对标书对话适中（约${r}%），本章应在冲突场景使用对话，非冲突场景以叙事推进`);
        else craftLines.push(`【对话要求】对标书对话较少（约${r}%），本章以叙事和描写为主，对话集中在关键转折处`);
      }
      if (cs.descriptionDistribution) {
        const dd = cs.descriptionDistribution as Record<string, number>;
        const maxType = Object.entries(dd).sort((a, b) => b[1] - a[1])[0][0];
        const STYLE_GUIDES: Record<string, string> = {
          action: "以动作描写为主要表达方式，用角色行动推进场景",
          visual: "重视画面感，用视觉细节让读者'看到'场景",
          internal: "通过内心活动深入表现角色状态和动机",
          sensory: "善用感官体验增强读者代入感",
        };
        craftLines.push(`【描写重点】${STYLE_GUIDES[maxType] ?? "以动作描写为主要表达方式"}`);
      }
      if (craftLines.length > 0) {
        blocks.push(createContextBlock({
          id: "craft_stats", group: "style_contract", priority: 71,
          content: craftLines.join("\n"), conflictGroup: "style_contract", freshness: 1,
        }));
      }
    }
  } catch { /* best-effort */ }

  // ── reference_exemplars ──
  try {
    const novel2 = await prisma.novel.findUnique({ where: { id: novelId }, select: { activeProfileId: true } });
    if (novel2?.activeProfileId) {
      const refProfile = await prisma.referenceProfile.findUnique({ where: { id: novel2.activeProfileId }, select: { analysisResult: true } });
      if (refProfile?.analysisResult) {
        const ar = JSON.parse(refProfile.analysisResult);
        const exemplars = (ar.annotations as Array<{chapterIndex:number;chapterType:string;coolPointLevel:string;hookType:string;exemplarOpening?:string;exemplarEnding?:string;summary?:string}> | undefined);
        if (exemplars?.length) {
          const targetType = chapterPlan?.chapterType ?? "advance";
          const targetPhase = chapterPlan?.loopPhase;
          let matches = targetPhase ? exemplars.filter(e => (e as any).loopPhase === targetPhase && (e as any).chapterType === targetType) : [];
          if (matches.length < 2) {
            matches = [...matches, ...exemplars.filter(e => e.chapterType === targetType && !matches.includes(e))].slice(0, 3);
          } else {
            matches = matches.slice(0, 3);
          }
          if (matches.length > 0) {
            const lines = ["【对标书写作范例 — 相同结构位置的章节是怎么写的】"];
            for (const m of matches) {
              lines.push(`\n--- 对标书第${m.chapterIndex}章 (${m.chapterType}/${m.coolPointLevel}/${m.hookType}) ---`);
              if (m.summary) lines.push(`内容概要：${m.summary}`);
              if (m.exemplarOpening) lines.push(`开头写法：${m.exemplarOpening.slice(0, 200)}`);
              if (m.exemplarEnding) lines.push(`结尾钩子：${m.exemplarEnding.slice(0, 200)}`);
            }
            blocks.push(createContextBlock({
              id: "reference_exemplars", group: "style_contract", priority: 77,
              content: lines.join("\n"), conflictGroup: "style_contract", freshness: 1,
            }));
          }
          // Expectation chain
          if (ar.writing?.expectations?.length) {
            const relevant = ar.writing.expectations.slice(0, 6);
            const expLines = ["【对标书读者期待链 — 回环结构的期待建立与兑现模式】"];
            for (const e of relevant) {
              expLines.push(`第${e.loopIndex}轮：${e.expectationType} | 建立(第${e.establishmentChapter}章)：${e.establishmentMethod} | 维持：${e.maintenanceMethod} | 兑现(第${e.fulfillmentChapter}章)：${e.fulfillmentMethod} | 新期待：${e.nextExpectation}`);
            }
            blocks.push(createContextBlock({
              id: "expectation_chain", group: "chapter_mission", priority: 96,
              content: expLines.join("\n"),
            }));
          }
        }
      }
    }
  } catch { /* best-effort */ }

  // ── content_beat_mission ──
  if (chapterPlan?.contentBeat) {
    const beatGuide = getContentBeatGuide(chapterPlan.contentBeat);
    blocks.push(createContextBlock({
      id: "content_beat_mission",
      group: "chapter_mission",
      priority: 98,
      content: `[本章内容节拍]\n类型：${chapterPlan.contentBeat}${beatGuide ? `\n写作指引：${beatGuide}` : ""}`,
    }));
  }

  // ── scene_plan ──
  try {
    const cards = chapter.scenePlan ? JSON.parse(chapter.scenePlan) : null;
    if (cards?.scenes && Array.isArray(cards.scenes) && cards.scenes.length > 0 && cards.enabled !== false) {
      const spContext = compileScenePlanContext({ scenes: cards.scenes, scenePlanGenerated: true, enabled: true });
      if (spContext) {
        blocks.push(createContextBlock({
          id: "scene_plan", group: "volume_window", priority: 93,
          content: spContext,
        }));
      }
    }
  } catch { /* ignore parse error */ }

  return blocks;
}

// ─── Chapter Context (flat representation for repair/diagnosis) ───

export interface ChapterContext {
  novelTitle: string; novelGenre: string | null;
  chapterTitle: string; chapterOrder: number; totalChapters: number;
  chapterExpectation: string | null; chapterHook: string | null;
  previousChapters: string; lastChapterEnding: string;
  characters: string; framing: string; outline: string;
  styleContext: string; antiAiPrompt: string;
  openConflicts: string; payoffContext: string; timelineContext: string;
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>;
  worldRules: string;
  scenePlanContext: string;
}

function findBlockContent(blocks: PromptContextBlock[], id: string): string {
  return blocks.find(b => b.id === id)?.content ?? "";
}

function blocksToChapterContext(
  base: Awaited<ReturnType<typeof fetchAssemblyBase>>,
  blocks: PromptContextBlock[],
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>,
): ChapterContext {
  const { novel, chapter } = base;

  const framing =
    findBlockContent(blocks, "book_contract_snapshot") ||
    findBlockContent(blocks, "book_contract_live");
  const characters =
    findBlockContent(blocks, "character_hard_facts_snapshot") ||
    findBlockContent(blocks, "character_hard_facts_live");
  const outline =
    findBlockContent(blocks, "volume_window_snapshot") ||
    findBlockContent(blocks, "volume_window_live") ||
    findBlockContent(blocks, "story_macro");

  return {
    novelTitle: novel.title,
    novelGenre: novel.genre,
    chapterTitle: chapter.title,
    chapterOrder: chapter.order,
    totalChapters: novel.chapters.length,
    chapterExpectation: chapter.expectation,
    chapterHook: chapter.hook,
    previousChapters: findBlockContent(blocks, "recent_chapters"),
    lastChapterEnding: findBlockContent(blocks, "previous_chapter_hook"),
    characters,
    framing,
    outline,
    styleContext: findBlockContent(blocks, "style_contract"),
    antiAiPrompt: findBlockContent(blocks, "opening_constraints"),
    openConflicts: findBlockContent(blocks, "open_conflicts"),
    payoffContext: findBlockContent(blocks, "payoff_directives"),
    timelineContext: findBlockContent(blocks, "timeline"),
    worldRules: findBlockContent(blocks, "world_rules"),
    scenePlanContext: findBlockContent(blocks, "scene_plan"),
    characterProhibitions,
  };
}

/**
 * Assemble flat ChapterContext for repair, scene planning, and diagnosis.
 * Delegates to assembleChapterBlocks() → blocksToChapterContext().
 */
export async function assembleChapterContext(novelId: string, chapterId: string): Promise<ChapterContext> {
  const base = await fetchAssemblyBase(novelId, chapterId);
  const blocks = await assembleChapterBlocks(novelId, chapterId);
  const characterProhibitions = await buildCharacterProhibitions(novelId);
  return blocksToChapterContext(base, blocks, characterProhibitions);
}
