/**
 * RAG Context Block Builder — 将 RAG 语义检索结果注入上下文块。
 *
 * 在 assembleChapterBlocks 中调用 RAGService.hybridSearch，
 * 根据章节任务（expectation）检索语义相关的过往内容，
 * 生成 rag_semantic_context 块注入到上下文中。
 */
import { getRAGService } from "../../../../platform/rag/ragService";
import { createContextBlock } from "../../../../platform/llm/contextSelection";
import type { PromptContextBlock } from "../../../../platform/llm/promptTypes";

// ─── 查询关键词触发器（参考 webnovel-writer 的思路） ────────────────────

const RELATION_KEYWORDS = ["关系", "恩怨", "冲突", "敌对", "同盟", "师徒", "身份", "背叛", "信任"];
const PLOT_KEYWORDS = ["线索", "伏笔", "回收", "真相", "来历", "秘密", "阴谋"];
const LOCATION_KEYWORDS = ["地点", "势力", "阵营", "地盘", "城市", "宗门", "家族"];

/**
 * 根据章节计划字段智能构建检索查询。
 * 返回多个变体 query，分别检索后 RRF 融合。
 */
function buildRagQueries(
  chapterExpectation: string | null,
  chapterTitle: string,
  chapterPurpose: string,
  contentBeat: string | null,
  loopPhase: string | null,
  coolPointType: string | null,
  chapterType: string | null,
): string[] {
  const queries: string[] = [];
  const allTexts = [chapterExpectation ?? "", chapterTitle, chapterPurpose, contentBeat ?? ""].filter(Boolean);
  const combined = allTexts.join(" ");

  // 基础查询：始终使用
  const baseQuery = [chapterExpectation, chapterTitle, chapterPurpose].filter(Boolean).join(" ");
  if (baseQuery) queries.push(baseQuery);

  // 智能变体 1：根据 loopPhase 构建结算导向查询
  if (loopPhase === "settlement" || combined.includes("结算")) {
    queries.push(`角色结算 能力获得 势力变化 突破 觉醒 ${combined}`);
  }

  // 智能变体 2：根据 contentBeat/关键词构建实体导向查询
  if (RELATION_KEYWORDS.some(k => combined.includes(k))) {
    queries.push(`人物关系 角色互动 动机 冲突 ${combined}`);
  }
  if (PLOT_KEYWORDS.some(k => combined.includes(k))) {
    queries.push(`伏笔 线索 真相 秘密 ${combined}`);
  }
  if (LOCATION_KEYWORDS.some(k => combined.includes(k))) {
    queries.push(`地点 势力 场景 环境 ${combined}`);
  }

  // 智能变体 3：根据 coolPointType 构建爽点参照查询
  if (coolPointType) {
    const coolPointMap: Record<string, string> = {
      collect: "收集 资源 装备 材料",
      strategy: "智谋 策略 布局 推理",
      verify: "验证 检验 展示 实力",
      reveal: "揭秘 真相 身份 反转",
      upgrade: "升级 突破 境界 进阶",
      face_slap: "打脸 碾压 震惊 反击",
    };
    const hint = coolPointMap[coolPointType];
    if (hint) queries.push(`${hint} ${combined}`);
  }

  // 智能变体 4：根据 chapterType 构建结构导向查询
  if (chapterType === "climax") {
    queries.push(`高潮 对抗 决战 紧张 ${combined}`);
  } else if (chapterType === "cooldown") {
    queries.push(`休整 恢复 过渡 缓冲 ${combined}`);
  }

  // 去重
  return [...new Set(queries)];
}

/**
 * 构建 RAG 语义上下文块。
 * 根据章节期望和计划字段智能构建多策略检索查询。
 */
export async function buildRagContextBlock(
  novelId: string,
  chapterOrder: number,
  chapterExpectation: string | null,
  chapterTitle: string,
  chapterPurpose: string,
  extraFields?: {
    contentBeat?: string | null;
    loopPhase?: string | null;
    coolPointType?: string | null;
    chapterType?: string | null;
  },
): Promise<PromptContextBlock | null> {
  const rag = getRAGService();
  // 即使 embedding API 不可用，BM25 仍然可用 — 不再因降级而完全放弃 RAG

  // 构建多策略查询
  const queries = buildRagQueries(
    chapterExpectation,
    chapterTitle,
    chapterPurpose,
    extraFields?.contentBeat ?? null,
    extraFields?.loopPhase ?? null,
    extraFields?.coolPointType ?? null,
    extraFields?.chapterType ?? null,
  );

  if (queries.length === 0) return null;

  // 多查询并行检索 + 合并去重（RRF 融合在 ragService 中处理）
  const allResults: import("../../../../platform/rag/ragService").SearchResult[] = [];
  const seen = new Set<string>();

  const batches = await Promise.all(
    queries.slice(0, 3).map(async (q) => rag.hybridSearch(q, 8, chapterOrder)),
  );
  for (const results of batches.flat()) {
    if (!seen.has(results.chunkId)) {
      seen.add(results.chunkId);
      allResults.push(results);
    }
  }

  if (allResults.length === 0) return null;

  const lines = ["【语义检索 — 以下为与本章任务语义相关的过往内容片段，帮助理解上下文和延续写作风格。】"];

  const scenes = allResults.filter((r: import("../../../../platform/rag/ragService").SearchResult) => r.chunkType === "scene");
  const summaries = allResults.filter((r: import("../../../../platform/rag/ragService").SearchResult) => r.chunkType === "summary");

  if (summaries.length > 0) {
    lines.push("");
    lines.push("== 相关章节摘要 ==");
    for (const r of summaries.slice(0, 5)) {
      lines.push(`[第${r.chapter}章 · 摘要 · 相关度${r.score.toFixed(3)}] ${r.content.slice(0, 500)}`);
    }
  }

  if (scenes.length > 0) {
    lines.push("");
    lines.push("== 相关场景片段 ==");
    for (const r of scenes.slice(0, 8)) {
      lines.push(`[第${r.chapter}章 · 场景${r.sceneIndex} · 相关度${r.score.toFixed(3)}] ${r.content.slice(0, 800)}`);
    }
  }

  const content = lines.join("\n");
  if (content.length < 50) return null; // 太少，跳过

  return createContextBlock({
    id: "rag_semantic_context",
    group: "rag_retrieval",
    priority: 82, // 与 recent_chapters 同级，预算紧张时保留
    content,
    instructionHeader: "【语义检索上下文 — 以下为与本章任务语义相关的过往内容。这些内容通过向量相似度检索得到，可能与本章直接相关也可能提供风格/场景参考。请酌情使用，不要机械照搬。】",
    conflictGroup: "rag_semantic",
    freshness: 1,
  });
}

/**
 * 构建 RAG 风格样本块 — 检索与当前章节类型相似的过往段落。
 */
export async function buildRagStyleSamplesBlock(
  novelId: string,
  chapterOrder: number,
  chapterType: string | null,
  contentBeat: string | null,
): Promise<PromptContextBlock | null> {
  const rag = getRAGService();
  // 即使 embedding API 不可用，BM25 仍然可用

  // 构建风格查询
  const queryParts = [
    chapterType ?? "",
    contentBeat ?? "",
  ].filter(Boolean);
  if (queryParts.length === 0) return null;

  const query = `小说写作 ${queryParts.join(" ")} 场景描写 对话`;
  const results: import("../../../../platform/rag/ragService").SearchResult[] = await rag.hybridSearch(query, 5, chapterOrder, "summary");

  if (results.length === 0) return null;

  const lines = ["【风格参考 — 以下为与当前章节类型相似的过往段落摘要，供写作风格参考。】"];
  for (const r of results) {
    lines.push(`[第${r.chapter}章] ${r.content.slice(0, 300)}`);
  }

  return createContextBlock({
    id: "rag_style_samples",
    group: "rag_retrieval",
    priority: 78,
    content: lines.join("\n"),
    instructionHeader: "【风格参考 — 以下为相似章节的摘要，帮助你保持风格一致性和节奏感。】",
    conflictGroup: "rag_style_samples",
    freshness: 1,
  });
}

// ─── Backtrack: 摘要 + 场景联动 ────────────────────────────

/**
 * 构建 Backtrack RAG block：检索场景片段后，回查其父摘要，
 * 形成"[章节摘要] → [相关场景]"的层次结构。
 *
 * 参考 webnovel-writer 的 search_with_backtrack 模式。
 */
export async function buildRagBacktrackBlock(
  novelId: string,
  chapterOrder: number,
  chapterExpectation: string | null,
  chapterTitle: string,
  chapterPurpose: string,
): Promise<PromptContextBlock | null> {
  const rag = getRAGService();

  const query = [chapterExpectation ?? "", chapterTitle, chapterPurpose].filter(Boolean).join(" ");
  if (!query) return null;

  // 1. 检索场景片段（只查 scene）
  const sceneResults: import("../../../../platform/rag/ragService").SearchResult[] = await rag.hybridSearch(query, 6, chapterOrder, "scene");
  if (sceneResults.length === 0) return null;

  // 2. 按章节号分组场景（同一章的场景归为一组）
  const scenesByChapter = new Map<number, typeof sceneResults>();

  for (const r of sceneResults) {
    if (scenesByChapter.has(r.chapter)) {
      scenesByChapter.get(r.chapter)!.push(r);
    } else {
      scenesByChapter.set(r.chapter, [r]);
    }
  }

  // 4. 构建层次化输出
  const lines = ["【语义检索 — 章节上下文与场景片段联动】"];

  for (const [chNum, scenes] of scenesByChapter) {
    lines.push(`\n[第${chNum}章]`);
    for (const s of scenes.slice(0, 2)) {
      lines.push(`  ↳ [场景${s.sceneIndex} · 相关度${s.score.toFixed(3)}] ${s.content.slice(0, 600)}`);
    }
  }

  const content = lines.join("\n");
  if (content.length < 50) return null;

  return createContextBlock({
    id: "rag_backtrack_context",
    group: "rag_retrieval",
    priority: 85, // 高于普通 RAG block，因为有层次结构
    content,
    instructionHeader: "【语义检索联动上下文 — 以下为与本章任务相关的章节及对应场景片段。章节级上下文帮助理解整体脉络，场景提供具体细节。请结合两层信息理解相关段落。】",
    conflictGroup: "rag_backtrack",
    freshness: 1,
  });
}
