/**
 * Anti-AI runtime detector — scans generated prose for AI traces.
 *
 * ADAPTED from OP AntiAiRuleService.ts (226 lines) and AntiAiPolicyResolver.ts (217 lines).
 * Streamlined for One2Novel's post-generation detection pipeline.
 *
 * Detection categories (from chinese-novelist Skill):
 * 1. High-frequency AI vocabulary hits
 * 2. Consecutive 4-character idiom stacking (≥2)
 * 3. Sentence pattern repetition (≥3 consecutive sentences with same subject)
 * 4. "的" density anomaly (>2 per sentence)
 * 5. AI linking words ("此外""然而""值得注意的是")
 * 6. Summary/conclusion sentences
 * 7. Excessive internal monologue ratio (>40%)
 */

// ─── Types ─────────────────────────────────────────────

export interface AiTraceHit {
  /** Detection category code */
  code: string;
  /** Human-readable category name */
  category: string;
  /** Severity: high = almost certainly AI, medium = likely, low = possible */
  severity: "high" | "medium" | "low";
  /** Description of what was detected */
  description: string;
  /** Suggested fix */
  suggestion: string;
  /** Approximate location (excerpt from text) */
  context: string;
}

export interface AiDetectionResult {
  hits: AiTraceHit[];
  /** Overall AI-trace score: 0 = clean, 100 = heavily AI-tainted */
  score: number;
  /** Human-readable summary */
  summary: string;
}

// ─── Detection Rules ───────────────────────────────────

/** Words strongly associated with AI-generated Chinese prose */
const AI_VOCAB: Array<{ word: string; severity: "high" | "medium" | "low" }> = [
  { word: "璀璨", severity: "medium" },
  { word: "瑰丽", severity: "medium" },
  { word: "心潮澎湃", severity: "high" },
  { word: "热血沸腾", severity: "high" },
  { word: "油然而生", severity: "high" },
  { word: "不禁", severity: "medium" },
  { word: "仿佛", severity: "low" },
  { word: "宛若", severity: "medium" },
  { word: "顷刻间", severity: "medium" },
  { word: "刹那间", severity: "medium" },
  { word: "弥漫", severity: "medium" },
  { word: "荡漾", severity: "medium" },
  { word: "涟漪", severity: "low" },
  { word: "无可名状", severity: "high" },
  { word: "难以言喻", severity: "high" },
  { word: "此情此景", severity: "medium" },
  { word: "永生难忘", severity: "medium" },
  { word: "铭刻在心", severity: "medium" },
];

/** AI-typical linking/transition words */
const AI_LINKERS = [
  "此外", "然而", "值得注意的是", "需要强调的是",
  "综上所述", "总而言之", "不可否认", "毋庸置疑",
  "当然", "与此同时", "另一方面",
];

/** Summary/conclusion pattern markers */
const SUMMARY_MARKERS = [
  "总之", "综上所述", "这一章", "通过这次", "这次经历让",
  "这件事告诉", "从此以后", "这一天的经历",
];

// ─── Detectors ─────────────────────────────────────────

function detectAiVocab(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  for (const { word, severity } of AI_VOCAB) {
    if (text.includes(word)) {
      // Find context (~20 chars around the word)
      const idx = text.indexOf(word);
      const start = Math.max(0, idx - 10);
      const end = Math.min(text.length, idx + word.length + 10);
      hits.push({
        code: "ai_vocab",
        category: "AI高频词汇",
        severity,
        description: `检测到AI常用词汇："${word}"`,
        suggestion: `将"${word}"替换为更具体、更有画面感的描写`,
        context: `...${text.slice(start, end)}...`,
      });
    }
  }
  return hits;
}

function detectIdiomStacking(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  // Match 4-character chunks (Chinese idiom pattern)
  const idiomRe = /[一-鿿]{4}/g;
  const sentences = text.split(/[。！？\n]/);

  for (const sentence of sentences) {
    const matches = sentence.match(idiomRe);
    if (matches && matches.length >= 2) {
      // Check for consecutive idiom-like patterns
      const joined = matches.join("");
      const idx = text.indexOf(joined.slice(0, 8));
      if (idx >= 0) {
        hits.push({
          code: "idiom_stack",
          category: "成语堆砌",
          severity: "medium",
          description: `检测到连续四字短语堆砌：${matches.slice(0, 3).join("、")}`,
          suggestion: "用具体描写代替成语，至少将其中一半展开为动作/场景细节",
          context: `...${text.slice(Math.max(0, idx - 5), Math.min(text.length, idx + 20))}...`,
        });
      }
    }
  }
  // Dedup by context
  return hits.filter((h, i, arr) => arr.findIndex(x => x.context === h.context) === i);
}

function detectPatternRepetition(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 5);

  // Check for consecutive sentences starting with same subject
  for (let i = 0; i < sentences.length - 2; i++) {
    const a = sentences[i].trim().charAt(0);
    const b = sentences[i + 1].trim().charAt(0);
    const c = sentences[i + 2].trim().charAt(0);

    if (a === b && b === c && /[一-鿿]/.test(a)) {
      const ctx = `${sentences[i].trim().slice(0, 15)}...`;
      hits.push({
        code: "pattern_repeat",
        category: "句式重复",
        severity: "medium",
        description: `连续3句以"${a}"开头，句式单一`,
        suggestion: "变换句式：合并短句、改被动/把字句、用状语开头等",
        context: ctx,
      });
    }
  }
  return hits;
}

function detectDeDensity(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 3);

  for (const sentence of sentences) {
    const deCount = (sentence.match(/的/g) || []).length;
    if (deCount > 2) {
      hits.push({
        code: "de_density",
        category: '"的"字密度',
        severity: "low",
        description: `单句含${deCount}个"的"字，读感拖沓`,
        suggestion: "拆分长句，或用动词替代'的'字结构（如'愤怒的他'→'他握紧拳头'）",
        context: sentence.trim().slice(0, 30) + (sentence.length > 30 ? "..." : ""),
      });
    }
  }
  return hits;
}

function detectAiLinkers(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  for (const linker of AI_LINKERS) {
    if (text.includes(linker)) {
      const idx = text.indexOf(linker);
      hits.push({
        code: "ai_linker",
        category: "AI连接词",
        severity: "high",
        description: `检测到AI常用连接词："${linker}"`,
        suggestion: `删除"${linker}"或用动作/场景切换代替逻辑连接`,
        context: `...${text.slice(Math.max(0, idx - 10), Math.min(text.length, idx + linker.length + 10))}...`,
      });
    }
  }
  return hits;
}

function detectSummarySentences(text: string): AiTraceHit[] {
  const hits: AiTraceHit[] = [];
  for (const marker of SUMMARY_MARKERS) {
    if (text.includes(marker)) {
      const idx = text.indexOf(marker);
      // Find the end of the sentence
      const endIdx = text.indexOf("。", idx);
      const fullSentence = endIdx > idx
        ? text.slice(idx, endIdx + 1)
        : text.slice(idx, idx + 30);
      hits.push({
        code: "summary",
        category: "总结性语句",
        severity: "high",
        description: `检测到总结性表述："${fullSentence.slice(0, 25)}..."`,
        suggestion: "删除总结句。用剧情推进代替结论，让读者自己体会",
        context: fullSentence.slice(0, 40),
      });
    }
  }
  return hits;
}

function detectMonologueRatio(text: string): AiTraceHit | null {
  // Rough estimate: count lines starting with "他想", "他觉得", "他心想", "他知道" etc.
  const monologuePatterns = /(他想|她觉得|心想|他知道|他明白|他意识到|他觉得|他认为|他感到|他想起|回忆起|脑海里|内心深处)/g;
  const matches = text.match(monologuePatterns) || [];
  const totalChars = text.replace(/\s/g, "").length;
  // Rough: each monologue marker ≈ 80 chars of internal monologue
  const estimatedMonologueChars = matches.length * 80;
  const ratio = totalChars > 0 ? estimatedMonologueChars / totalChars : 0;

  if (ratio > 0.4) {
    return {
      code: "monologue_ratio",
      category: "内心独白过多",
      severity: "medium",
      description: `内心独白估计占正文${Math.round(ratio * 100)}%，超过40%阈值`,
      suggestion: "将至少一半内心活动转化为对话或动作。用身体反应代替直接陈述情感",
      context: `检测到${matches.length}处内心独白标记`,
    };
  }
  return null;
}

// ─── Main Entry ────────────────────────────────────────

export function detectAiTraces(text: string): AiDetectionResult {
  const stripped = text.replace(/<[^>]*>/g, ""); // Strip HTML tags

  const allHits: AiTraceHit[] = [
    ...detectAiVocab(stripped),
    ...detectIdiomStacking(stripped),
    ...detectPatternRepetition(stripped),
    ...detectDeDensity(stripped),
    ...detectAiLinkers(stripped),
    ...detectSummarySentences(stripped),
  ];

  const monologue = detectMonologueRatio(stripped);
  if (monologue) allHits.push(monologue);

  // Dedup by context
  const uniqueHits = allHits.filter((h, i, arr) =>
    arr.findIndex(x => x.code === h.code && x.context === h.context) === i,
  );

  // Score: high=15, medium=8, low=3. Cap at 100.
  const rawScore = uniqueHits.reduce((sum, h) => {
    return sum + (h.severity === "high" ? 15 : h.severity === "medium" ? 8 : 3);
  }, 0);
  const score = Math.min(100, rawScore);

  // Summary
  const highCount = uniqueHits.filter(h => h.severity === "high").length;
  const mediumCount = uniqueHits.filter(h => h.severity === "medium").length;
  const lowCount = uniqueHits.filter(h => h.severity === "low").length;

  let summary: string;
  if (score === 0) {
    summary = "未检测到明显AI痕迹，文字自然度良好。";
  } else if (score < 25) {
    summary = `检测到少量AI痕迹（${uniqueHits.length}处），整体自然度较好。`;
  } else if (score < 50) {
    summary = `检测到${uniqueHits.length}处AI痕迹（严重${highCount}项/中等${mediumCount}项/轻度${lowCount}项），建议局部修改。`;
  } else {
    summary = `AI痕迹较明显（共${uniqueHits.length}处：严重${highCount}项/中等${mediumCount}项/轻度${lowCount}项），建议深度润色或使用「修复」功能。`;
  }

  return { hits: uniqueHits, score, summary };
}
