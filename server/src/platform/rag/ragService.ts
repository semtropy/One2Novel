/**
 * RAG Service — 语义检索层
 *
 * 为百万字级长篇小说提供语义检索能力。
 * 核心思路：章节写成后自动切片 → 调用 Embedding API → 存入 SQLite
 * 写作时通过 hybridSearch 召回相关段落注入上下文块。
 *
 * 设计原则：
 * - 不计 token 或预算上限 — 语义检索的质量高于一切
 * - 不依赖外部向量数据库 — SQLite 内嵌存储，零运维
 * - 优雅降级 — Embedding API 失败时回退 BM25-only
 * - 写后自动入库 — 不阻塞写作流程
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import Database from "better-sqlite3";
import path from "node:path";
import { getEnv } from "../config/env";
import { logEventError } from "../logging/eventErrorLog";

// ─── Types ───────────────────────────────────────────────

export interface SearchResult {
  chunkId: string;
  chapter: number;
  sceneIndex: number;
  content: string;
  score: number;
  source: "vector" | "bm25" | "hybrid";
  chunkType: "scene" | "summary" | "event";
}

export interface ChunkConfig {
  sceneChunkSize: number;
  sceneOverlap: number;
  summaryChunkSize: number;
  maxScenesPerChapter: number;
}

const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  sceneChunkSize: 1500,
  sceneOverlap: 300,
  summaryChunkSize: 2000,
  maxScenesPerChapter: 20,
};

// ─── SQLite Schema ───────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS vectors (
    chunk_id TEXT PRIMARY KEY,
    chapter INTEGER NOT NULL,
    scene_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding BLOB,
    parent_chunk_id TEXT,
    chunk_type TEXT DEFAULT 'scene',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bm25_index (
    term TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    tf REAL NOT NULL,
    PRIMARY KEY (term, chunk_id)
  );
  CREATE TABLE IF NOT EXISTS doc_stats (
    chunk_id TEXT PRIMARY KEY,
    doc_length INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vectors_chapter ON vectors(chapter);
  CREATE INDEX IF NOT EXISTS idx_vectors_parent ON vectors(parent_chunk_id);
  CREATE INDEX IF NOT EXISTS idx_vectors_type ON vectors(chunk_type);
  CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term);
  CREATE INDEX IF NOT EXISTS idx_vectors_chapter_type ON vectors(chapter, chunk_type);
`;

// ─── Helpers ─────────────────────────────────────────────

function tokenize(text: string): string[] {
  const chinese = text.match(/[一-龥々ー〇〻]+/g) || [];
  const english = text.match(/[a-zA-Z]+/g) || [];
  const numbers = text.match(/\d+/g) || [];
  return [...chinese, ...english, ...numbers];
}

function serializeEmbedding(embedding: number[]): Buffer {
  const buf = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

function deserializeEmbedding(data: Buffer): number[] {
  const count = data.byteLength / 4;
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = data.readFloatLE(i * 4);
  }
  return Array.from(result);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function bm25Score(
  termFreq: number, docLength: number, avgDocLength: number,
  totalDocs: number, df: number,
  k1: number = 1.5, b: number = 0.75,
): number {
  const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
  const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * docLength / avgDocLength));
  return idf * tfNorm;
}

// ─── RAG Service ─────────────────────────────────────────

export class RAGService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private config: ChunkConfig;
  private embeddings: OpenAIEmbeddings | null = null;
  /** Timestamp when embedding API first failed (null = healthy). Used for observability only. */
  private degradedSince: number | null = null;
  private lastError: string | null = null;

  constructor(config?: Partial<ChunkConfig>) {
    this.config = { ...DEFAULT_CHUNK_CONFIG, ...config };
    const env = getEnv();
    const dbFile = env.DATABASE_URL.replace("file:", "");
    const dbDir = path.resolve(path.dirname(dbFile), "..");
    this.dbPath = path.join(dbDir, "rag_vectors.db");
  }

  private getEmbeddingClient(): OpenAIEmbeddings | null {
    if (this.embeddings) return this.embeddings;
    const env = getEnv();

    const createClient = (opts: { apiKey: string; basePath?: string; model: string }) =>
      new OpenAIEmbeddings({
        model: opts.model,
        openAIApiKey: opts.apiKey,
        ...(opts.basePath ? { basePath: opts.basePath } : {}),
        batchSize: 64,
        maxRetries: 2,
      });

    // DeepSeek (OpenAI-compatible)
    if (env.DEEPSEEK_API_KEY) {
      try {
        this.embeddings = createClient({
          apiKey: env.DEEPSEEK_API_KEY,
          basePath: env.DEEPSEEK_BASE_URL,
          model: "bge-m3",
        });
        return this.embeddings;
      } catch { /* fall through */ }
    }

    // OpenAI
    if (env.OPENAI_API_KEY) {
      try {
        this.embeddings = createClient({
          apiKey: env.OPENAI_API_KEY,
          basePath: env.OPENAI_BASE_URL,
          model: "text-embedding-3-small",
        });
        return this.embeddings;
      } catch { /* fall through */ }
    }

    // Qwen / DashScope
    if (env.QWEN_API_KEY) {
      try {
        this.embeddings = createClient({
          apiKey: env.QWEN_API_KEY,
          basePath: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          model: "text-embedding-v3",
        });
        return this.embeddings;
      } catch { /* fall through */ }
    }

    return null;
  }

  private ensureDb(): Database.Database {
    if (this.db) return this.db;
    const fs = require("node:fs");
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ─── Store ────────────────────────────────────────────

  async storeChapter(
    chapterOrder: number,
    title: string,
    content: string,
    summary?: string,
  ): Promise<{ stored: number; skipped: number }> {
    const db = this.ensureDb();
    let stored = 0;
    let skipped = 0;

    // 存储摘要（UPSERT）
    if (summary) {
      await this.storeChunk(db, {
        chunkId: `ch${chapterOrder}_summary`,
        chapter: chapterOrder, sceneIndex: 0,
        content: summary, parentChunkId: null,
        chunkType: "summary",
        sourceFile: `chapters/ch${chapterOrder}_${title}`,
      });
      stored++;
    }

    // 按句子切片
    const sentences = this.splitIntoSentences(content);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > this.config.sceneChunkSize && currentChunk.length > 100) {
        chunks.push(currentChunk);
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }
    if (currentChunk.length > 100) {
      chunks.push(currentChunk);
    }

    const limitedChunks = chunks.slice(0, this.config.maxScenesPerChapter);

    for (let i = 0; i < limitedChunks.length; i++) {
      await this.storeChunk(db, {
        chunkId: `ch${chapterOrder}_s${i}`,
        chapter: chapterOrder, sceneIndex: i,
        content: limitedChunks[i], parentChunkId: summary ? `ch${chapterOrder}_summary` : null,
        chunkType: "scene",
        sourceFile: `chapters/ch${chapterOrder}_${title}`,
      });
      stored++;
    }

    return { stored, skipped };
  }

  private async storeChunk(
    db: Database.Database,
    chunk: {
      chunkId: string; chapter: number; sceneIndex: number;
      content: string; parentChunkId: string | null;
      chunkType: "scene" | "summary"; sourceFile: string;
    },
  ): Promise<void> {
    // BM25 索引总是更新（不依赖 embedding API）
    this.updateBm25Index(db, chunk.chunkId, chunk.content);

    // Try embedding — if it fails, chunk is still stored for BM25-only search
    const embeddings = this.getEmbeddingClient();
    if (!embeddings) {
      // No embedding client configured — store without embedding
      db.prepare(`
        INSERT OR REPLACE INTO vectors (chunk_id, chapter, scene_index, content, parent_chunk_id, chunk_type, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chunk.chunkId, chunk.chapter, chunk.sceneIndex, chunk.content,
        chunk.parentChunkId, chunk.chunkType, chunk.sourceFile);
      return;
    }

    try {
      const emb = await embeddings.embedDocuments([chunk.content]);
      const embeddingBytes = serializeEmbedding(emb[0]);
      db.prepare(`
        INSERT OR REPLACE INTO vectors (chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chunk.chunkId, chunk.chapter, chunk.sceneIndex, chunk.content,
        embeddingBytes, chunk.parentChunkId, chunk.chunkType, chunk.sourceFile);
    } catch (e) {
      // Per-chunk failure: store without embedding (BM25 still works)
      this.degradedSince = this.degradedSince ?? Date.now();
      this.lastError = e instanceof Error ? e.message : String(e);
      logEventError("rag.embedding_failed", { chunkId: chunk.chunkId }, e);

      db.prepare(`
        INSERT OR REPLACE INTO vectors (chunk_id, chapter, scene_index, content, parent_chunk_id, chunk_type, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(chunk.chunkId, chunk.chapter, chunk.sceneIndex, chunk.content,
        chunk.parentChunkId, chunk.chunkType, chunk.sourceFile);
    }
  }

  // ─── BM25 ─────────────────────────────────────────────

  private updateBm25Index(db: Database.Database, chunkId: string, content: string): void {
    const tokens = tokenize(content);
    if (tokens.length === 0) return;

    const docLength = tokens.length;
    const tfCounter = new Map<string, number>();
    for (const token of tokens) {
      tfCounter.set(token, (tfCounter.get(token) || 0) + 1);
    }

    db.prepare("DELETE FROM bm25_index WHERE chunk_id = ?").run(chunkId);
    db.prepare("DELETE FROM doc_stats WHERE chunk_id = ?").run(chunkId);

    const insertBm25 = db.prepare("INSERT INTO bm25_index (term, chunk_id, tf) VALUES (?, ?, ?)");
    const insertDocStats = db.prepare("INSERT INTO doc_stats (chunk_id, doc_length) VALUES (?, ?)");

    for (const [term, count] of tfCounter) {
      insertBm25.run(term, chunkId, count / docLength);
    }
    insertDocStats.run(chunkId, docLength);
  }

  // ─── Search ───────────────────────────────────────────

  async hybridSearch(
    query: string,
    topK: number = 15,
    chapterLt?: number,
    chunkType?: "scene" | "summary",
  ): Promise<SearchResult[]> {
    const db = this.ensureDb();
    const embeddings = this.getEmbeddingClient();

    // 向量搜索（每次尝试，不依赖全局 degraded 标志）
    let vectorResults: SearchResult[] = [];
    if (embeddings) {
      try {
        vectorResults = await this.vectorSearch(db, query, topK * 3, chapterLt, chunkType);
      } catch {
        // Per-request vector failure — log but continue with BM25
        this.degradedSince = this.degradedSince ?? Date.now();
        this.lastError = "vector_search_failed";
      }
    }

    // BM25 搜索（始终可用）
    const bm25Results = this.bm25Search(db, query, topK * 3, chapterLt, chunkType);

    // 如果没有向量结果，直接返回 BM25
    if (vectorResults.length === 0) {
      return bm25Results.slice(0, topK);
    }

    // RRF 融合
    const fused = this.rrfFuse(vectorResults, bm25Results, topK * 2);

    // Rerank 精排（对融合后的候选做二次排序）
    return this.rerank(query, fused, topK);
  }

  private async vectorSearch(
    db: Database.Database,
    query: string,
    topK: number,
    chapterLt?: number,
    chunkType?: "scene" | "summary",
  ): Promise<SearchResult[]> {
    const embeddings = this.getEmbeddingClient()!;
    const queryEmb = await embeddings.embedDocuments([query]);
    const queryVector = queryEmb[0];

    let rows: Array<[string, number, number, string, Buffer | null, string | null, string, string]>;
    if (chapterLt && chunkType) {
      rows = db.prepare(
        "SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors WHERE chapter <= ? AND chunk_type = ? ORDER BY chapter DESC, scene_index DESC"
      ).all(chapterLt, chunkType) as any;
    } else if (chapterLt) {
      rows = db.prepare(
        "SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors WHERE chapter <= ? ORDER BY chapter DESC, scene_index DESC"
      ).all(chapterLt) as any;
    } else {
      rows = db.prepare(
        "SELECT chunk_id, chapter, scene_index, content, embedding, parent_chunk_id, chunk_type, source_file FROM vectors ORDER BY chapter DESC, scene_index DESC"
      ).all() as any;
    }

    const results: SearchResult[] = [];
    for (const row of rows) {
      if (!row[4]) continue; // skip no embedding
      const vec = deserializeEmbedding(row[4] as Buffer);
      const score = cosineSimilarity(queryVector, vec);
      results.push({
        chunkId: row[0], chapter: row[1], sceneIndex: row[2],
        content: row[3], score, source: "vector", chunkType: row[6] as SearchResult["chunkType"],
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private bm25Search(
    db: Database.Database,
    query: string,
    topK: number,
    chapterLt?: number,
    chunkType?: "scene" | "summary",
  ): SearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    // 获取文档统计
    const statsRow = db.prepare("SELECT COUNT(*), AVG(doc_length) FROM doc_stats").get() as [number, number];
    const totalDocs = statsRow[0] || 1;
    const avgDocLength = statsRow[1] || 1;

    const docScores = new Map<string, number>();

    for (const term of new Set(queryTerms)) {
      const docs = db.prepare(
        "SELECT chunk_id, tf, doc_length FROM bm25_index b JOIN doc_stats d ON b.chunk_id = d.chunk_id WHERE b.term = ?"
      ).all(term) as Array<{ chunk_id: string; tf: number; doc_length: number }>;

      const df = docs.length;
      if (df === 0) continue;

      for (const doc of docs) {
        const score = bm25Score(doc.tf, doc.doc_length, avgDocLength, totalDocs, df);
        docScores.set(doc.chunk_id, (docScores.get(doc.chunk_id) || 0) + score);
      }
    }

    // 获取内容
    const results: SearchResult[] = [];
    for (const [chunkId, score] of docScores) {
      const row = db.prepare(
        "SELECT chapter, scene_index, content, parent_chunk_id, chunk_type, source_file FROM vectors WHERE chunk_id = ?"
      ).get(chunkId) as any;
      if (row) {
        results.push({
          chunkId, chapter: row[0], sceneIndex: row[1],
          content: row[2], score, source: "bm25",
          chunkType: row[4] as SearchResult["chunkType"],
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private rrfFuse(
    vectorResults: SearchResult[],
    bm25Results: SearchResult[],
    topK: number,
  ): SearchResult[] {
    const k = 60; // RRF constant
    const fused = new Map<string, { score: number; result: SearchResult }>();

    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i];
      const existing = fused.get(r.chunkId);
      if (existing) {
        existing.score += 1 / (k + i + 1);
      } else {
        fused.set(r.chunkId, { score: 1 / (k + i + 1), result: r });
      }
    }

    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i];
      const existing = fused.get(r.chunkId);
      if (existing) {
        existing.score += 1 / (k + i + 1);
      } else {
        fused.set(r.chunkId, { score: 1 / (k + i + 1), result: r });
      }
    }

    const sorted = [...fused.values()].sort((a, b) => b.score - a.score);
    return sorted.slice(0, topK).map(s => s.result);
  }

  // ─── Rerank ────────────────────────────────────────────

  /**
   * 调用 OpenAI-compatible rerank API（DeepSeek/OpenAI/通义千问均支持）。
   * 完全无 API 时回退到 BM25 重加权。
   */
  private async callRerankApi(query: string, documents: string[]): Promise<Array<{ index: number; relevance_score: number }>> {
    const env = getEnv();

    // Try DeepSeek rerank (OpenAI-compatible, expects /v1/rerank)
    if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_BASE_URL) {
      try {
        const baseUrl = env.DEEPSEEK_BASE_URL.endsWith("/v1") ? env.DEEPSEEK_BASE_URL : `${env.DEEPSEEK_BASE_URL}/v1`;
        const res = await fetch(`${baseUrl}/rerank`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "bge-reranker-v2-m3", query, documents }),
        });
        if (res.ok) {
          const data = await res.json();
          return (data.data as Array<{ index: number; relevance_score: number }>) ?? [];
        }
      } catch { /* fall through */ }
    }

    // Try OpenAI rerank
    if (env.OPENAI_API_KEY) {
      try {
        const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
        const res = await fetch(`${baseUrl}/reranks`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "rerank-2", query, documents }),
        });
        if (res.ok) {
          const data = await res.json();
          return (data.data as Array<{ index: number; relevance_score: number }>) ?? [];
        }
      } catch { /* fall through */ }
    }

    // Try Qwen/DashScope rerank
    if (env.QWEN_API_KEY) {
      try {
        const res = await fetch("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/rerank", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.QWEN_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "bge-reranker-v2-m3", query, documents }),
        });
        if (res.ok) {
          const data = await res.json();
          return (data.data as Array<{ index: number; relevance_score: number }>) ?? [];
        }
      } catch { /* fall through */ }
    }

    return [];
  }

  /**
   * 无 rerank API 时的降级方案：用 BM25 对候选结果重加权。
   */
  private bm25ReRank(results: SearchResult[], query: string): SearchResult[] {
    if (results.length <= 1) return results;
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return results;

    return results.map(r => {
      const docTerms = tokenize(r.content);
      let overlap = 0;
      for (const qt of queryTerms) {
        if (docTerms.some(dt => dt === qt || dt.includes(qt) || qt.includes(dt))) overlap++;
      }
      return { ...r, score: r.score * (1 + overlap * 0.3) };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Rerank 精排：对 RRF 融合后的候选结果进行二次排序。
   */
  async rerank(query: string, results: SearchResult[], topN: number): Promise<SearchResult[]> {
    if (results.length <= 1) return results;

    const documents = results.map(r => r.content);

    // 尝试 API rerank
    const apiResults = await this.callRerankApi(query, documents);
    if (apiResults.length > 0) {
      const scoreMap = new Map<number, number>();
      for (const r of apiResults) {
        scoreMap.set(r.index, r.relevance_score);
      }
      // Pre-compute scores to avoid O(n²) indexOf inside sort comparator
      const scored = results.map((r, i) => ({ result: r, score: scoreMap.get(i) ?? 0 }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topN).map(s => s.result);
    }

    // 降级：BM25 重加权
    return this.bm25ReRank(results, query).slice(0, topN);
  }

  // ─── Utility ──────────────────────────────────────────

  /** 按句子切分文本（支持中英文标点） */
  private splitIntoSentences(text: string): string[] {
    // 按中文/英文句子边界切分
    const sentences = text.match(/[^。！？.!?]+[。！？.!?]*/g) || [];
    return sentences
      .map(s => s.trim())
      .filter(s => s.length > 20); // 过滤太短的片段
  }

  /** 获取统计信息 */
  getStats(): { vectors: number; terms: number; maxChapter: number; withEmbedding: number; withoutEmbedding: number } {
    const db = this.ensureDb();
    const vectors = db.prepare("SELECT COUNT(*) as cnt FROM vectors").get() as { cnt: number };
    const terms = db.prepare("SELECT COUNT(DISTINCT term) as cnt FROM bm25_index").get() as { cnt: number };
    const maxChapter = db.prepare("SELECT MAX(chapter) as max_ch FROM vectors").get() as { max_ch: number | null };
    const withEmbedding = db.prepare("SELECT COUNT(*) as cnt FROM vectors WHERE embedding IS NOT NULL").get() as { cnt: number };
    const withoutEmbedding = db.prepare("SELECT COUNT(*) as cnt FROM vectors WHERE embedding IS NULL").get() as { cnt: number };
    return {
      vectors: vectors.cnt,
      terms: terms.cnt,
      maxChapter: maxChapter.max_ch || 0,
      withEmbedding: withEmbedding.cnt,
      withoutEmbedding: withoutEmbedding.cnt,
    };
  }

  /** 是否曾经发生过 embedding 失败（可恢复，不代表当前不可用） */
  hasEverDegraded(): boolean {
    return this.degradedSince !== null;
  }

  /** 首次 embedding 失败的时间戳，null 表示一直健康 */
  getDegradedSince(): number | null {
    return this.degradedSince;
  }

  /** 最近的错误信息 */
  getLastError(): string | null {
    return this.lastError;
  }
}

// ─── Singleton ───────────────────────────────────────────

let _service: RAGService | null = null;

export function getRAGService(config?: Partial<ChunkConfig>): RAGService {
  if (!_service) {
    _service = new RAGService(config);
  }
  return _service;
}

export function resetRAGService(): void {
  if (_service) {
    _service.close();
    _service = null;
  }
}
