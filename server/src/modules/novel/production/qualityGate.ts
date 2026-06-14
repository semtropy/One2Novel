import { z } from "zod";
import { aiInvoke } from "../../../platform/llm/aiService";
import { enrichQualityIssues } from "./qualityDiagnostics";

const RawQualitySchema = z.object({
  openingScore: z.number().optional(),
  plotScore: z.number().optional(),
  characterScore: z.number().optional(),
  dialogueScore: z.number().optional(),
  suspenseScore: z.number().optional(),
  pacingScore: z.number().optional(),
  showNotTellScore: z.number().optional(),  // Skill核心维度: 展示而非讲述
  languageScore: z.number().optional(),
  genreScore: z.number().optional(),
  coherenceScore: z.number().optional(),   // 跨章连贯性
  overallComment: z.string().optional(),
  comment: z.string().optional(),
  summary: z.string().optional(),
  issues: z.array(z.object({
    type: z.string().optional().default("一般"),
    category: z.string().optional().default("一般"),
    severity: z.string().optional().default("中"),
    description: z.string().optional().default(""),
    fixSuggestion: z.string().optional().default(""),
  })).optional(),
}).passthrough();

export type Verdict = "PASS" | "WARNING" | "NEEDS_FIX" | "BLOCKED";

export interface QualityResult {
  openingScore: number; plotScore: number; characterScore: number;
  dialogueScore: number; suspenseScore: number; pacingScore: number;
  showNotTellScore: number;  // Skill三大黄金法则之一
  languageScore: number; genreScore: number;
  coherenceScore: number;   // 跨章连贯性
  overallComment: string;
  verdict: Verdict;
  issues?: Array<{ type: string; severity: string; description: string; fixSuggestion: string }>;
}

export interface QualityGateOptions {
  /** Genre hint for genre-specific check dimensions */
  genre?: string | null;
  /** Character prohibitions to enforce (name → forbidden behaviors) */
  characterProhibitions?: Array<{ name: string; prohibitions: string[] }>;
  /** Chapter expectation for obligation checking */
  chapterExpectation?: string | null;
  /** Previous chapter summary for cross-chapter coherence checking */
  previousChapterSummary?: string | null;
  /** Previous chapter ending hook (last ~200 chars) for handoff check */
  previousChapterEnding?: string | null;
}

// ─── Genre-specific check dimensions ──────────────────

type GenreCategory = "悬疑" | "推理" | "言情" | "爱情" | "奇幻" | "科幻" | "成长" | "励志" | "动作" | "冒险" | "default";

function classifyGenre(genre?: string | null): GenreCategory {
  if (!genre) return "default";
  const g = genre.toLowerCase();
  if (g.includes("悬疑") || g.includes("推理") || g.includes("侦探") || g.includes("犯罪")) return "悬疑";
  if (g.includes("言情") || g.includes("爱情") || g.includes("恋爱") || g.includes("浪漫")) return "言情";
  if (g.includes("奇幻") || g.includes("魔法") || g.includes("仙侠") || g.includes("玄幻")) return "奇幻";
  if (g.includes("科幻") || g.includes("未来") || g.includes("机甲") || g.includes("星际")) return "科幻";
  if (g.includes("成长") || g.includes("励志") || g.includes("青春") || g.includes("校园")) return "成长";
  if (g.includes("动作") || g.includes("冒险") || g.includes("武侠")) return "动作";
  return "default";
}

function genreCheckDimensions(cat: GenreCategory): string {
  switch (cat) {
    case "悬疑":
    case "推理":
      return [
        "8. 线索布局：关键线索是否自然埋入叙事中（不突兀、不被忽略）？是否有铺垫→揭示的节奏感？",
        "9. 谜题逻辑：谜题/案件的逻辑链条是否合理？是否存在前后矛盾或强行解释？",
        "10. 信息揭示：信息释放是否有层次感（不过早剧透、不过晚让读者失去耐心）？",
        "11. 红鲱鱼/误导：是否存在合理的误导线索（非强行反转）？读者预期与实际真相之间是否有巧妙落差？",
      ].join("\n");
    case "言情":
    case "爱情":
      return [
        "8. 关系张力：CP之间是否存在实质性的情感张力（吸引力/矛盾/不确定性至少占其一）？",
        "9. 情感节奏：心动→试探→冲突→靠近/疏远的节奏是否自然，是否有过快的突兀感？",
        "10. CP化学反应：两人的互动是否有独特性（非模板化甜宠）？对话/动作中是否透出角色本色？",
        "11. 冲突真实性：阻碍关系发展的冲突是否有说服力（非狗血误会/强行分离）？",
      ].join("\n");
    case "奇幻":
    case "科幻":
      return [
        "8. 世界观一致性：本章对世界规则/设定的使用是否与已建立规则一致，有无自相矛盾？",
        "9. 新奇感：设定/场景/能力是否持续提供新鲜感，而非重复已知信息？",
        "10. 设定融入：世界设定是否通过剧情自然展示（展示而非说明），有无大段设定堆砌？",
        "11. 规则代价：能力/规则的使用是否有代价/限制（避免龙傲天/金手指万能感）？",
      ].join("\n");
    case "成长":
    case "励志":
      return [
        "8. 成长可见性：主角是否在本章表现出可感知的认知/能力变化，而非原地踏步？",
        "9. 挫折真实性：主角遇到的挫折是否有说服力（来自自身缺陷/外部压力/道德困境）？",
        "10. 顿悟时刻：关键认知转折是否有足够的铺垫，不显得突兀或说教？",
      ].join("\n");
    case "动作":
    case "冒险":
      return [
        "8. 动作描写：动作场景是否清晰、有节奏、有画面感（读者能『看到』发生了什么）？",
        "9. 紧张感递进：动作/冒险场景的紧张程度是否有递进（而非平铺直叙）？",
        "10. 后果意义：动作/冒险的结果是否对剧情有实质影响（非为打而打）？",
      ].join("\n");
    default:
      return [
        "8. 题材适配：本章的叙事方式是否与题材预期匹配（非串味/跑题）？",
        "9. 类型满足：本章是否提供了该题材读者期待的核心体验？",
      ].join("\n");
  }
}

function genreScoreLabels(cat: GenreCategory): string[] {
  switch (cat) {
    case "悬疑": return ["线索布局", "谜题逻辑", "信息揭示", "误导设计"];
    case "言情": return ["关系张力", "情感节奏", "CP反应", "冲突真实"];
    case "奇幻": case "科幻": return ["世界观一致", "新奇感", "设定融入", "规则代价"];
    case "成长": return ["成长可见", "挫折真实", "顿悟时刻"];
    case "动作": return ["动作描写", "紧张递进", "后果意义"];
    default: return ["题材适配", "类型满足"];
  }
}

// ─── Character prohibition enforcement ────────────────

interface ProhibitionViolation {
  characterName: string;
  prohibition: string;
  evidence: string;
}

/** Scan content for violations of character prohibitions (rule-based, no LLM) */
function scanProhibitionViolations(
  content: string,
  characterProhibitions: QualityGateOptions["characterProhibitions"],
): ProhibitionViolation[] {
  if (!characterProhibitions || characterProhibitions.length === 0) return [];

  const violations: ProhibitionViolation[] = [];
  const stripped = content.replace(/<[^>]*>/g, "");

  for (const char of characterProhibitions) {
    for (const prohibition of char.prohibitions) {
      // Match the prohibition in content using fuzzy patterns
      const patterns = prohibitionToPatterns(prohibition);
      for (const pattern of patterns) {
        const match = stripped.match(pattern);
        if (match) {
          const idx = match.index ?? 0;
          const evidence = stripped.slice(Math.max(0, idx - 15), Math.min(stripped.length, idx + match[0].length + 20));
          violations.push({
            characterName: char.name,
            prohibition,
            evidence: evidence.length > 50 ? `...${evidence}...` : evidence,
          });
          break; // One match per prohibition is enough
        }
      }
    }
  }

  return violations;
}

/** Convert a Chinese prohibition text to regex patterns for fuzzy matching.
 *  Returns patterns array (may be empty if no hardcoded or character-based patterns match). */
function prohibitionToPatterns(prohibition: string): RegExp[] {
  const patterns: RegExp[] = [];

  // Pattern categories (8 hardcoded fast-paths)
  if (/善良|仁慈|心软|手下留情|不忍/.test(prohibition)) {
    patterns.push(/善良|仁慈|心软|手下留情|不忍|同情|怜悯/);
  }
  if (/背叛|出卖|欺骗|撒谎/.test(prohibition)) {
    patterns.push(/背叛|出卖|欺骗|撒谎|说谎|不忠/);
  }
  if (/杀人|杀害|致命|取命/.test(prohibition)) {
    patterns.push(/杀[死了掉害]|致命|取[他她它]命|下杀手/);
  }
  if (/逃跑|退缩|逃避|胆怯/.test(prohibition)) {
    patterns.push(/逃跑|退缩|逃避|胆怯|害怕|恐惧|躲避/);
  }
  if (/哭|流泪|软弱|脆弱/.test(prohibition)) {
    patterns.push(/哭[了泣]|流泪|软弱|脆弱|眼泪|泪水/);
  }
  if (/信任|依赖|依靠|求助/.test(prohibition)) {
    patterns.push(/信任|依赖|依靠|求助|相信|托付/);
  }
  if (/说出|透露|坦白|承认|泄露.*秘密/.test(prohibition)) {
    patterns.push(/说出.*真相|透露|坦白|承认|泄露/);
  }
  if (/主动|率先/.test(prohibition)) {
    patterns.push(/主动|率先|自愿/);
  }

  // Character-based fallback for unknown prohibitions
  if (patterns.length === 0) {
    const chars = prohibition.replace(/[^一-鿿]/g, "");
    if (chars.length >= 2) {
      const keyChars = chars.slice(0, Math.min(4, chars.length));
      patterns.push(new RegExp(keyChars));
    }
  }

  return patterns;
}

// ─── Severity normalization ───────────────────────────

function normSeverity(s?: string): "low" | "medium" | "high" {
  if (!s) return "medium";
  if (/低|low|minor/i.test(s)) return "low";
  if (/高|high|critical|严重|致命/i.test(s)) return "high";
  return "medium";
}

// ─── Main entry ──────────────────────────────────────

export async function runQualityGate(
  content: string,
  opts?: QualityGateOptions,
): Promise<QualityResult> {
  const cat = classifyGenre(opts?.genre);
  const genreDimensions = genreCheckDimensions(cat);

    const charProhibitionText = opts?.characterProhibitions && opts.characterProhibitions.length > 0 ? (opts.characterProhibitions.map(c => c.name + "：禁止以下行为——" + c.prohibitions.join("、")).join("\n")) : "";

  const raw = await aiInvoke({
    assetId: "novel.chapter.review",
    templateVars: { genreCheckDimensions: genreDimensions, previousChapterSummary: opts?.previousChapterSummary ?? "", previousChapterEnding: opts?.previousChapterEnding ?? "", chapterExpectation: opts?.chapterExpectation ?? "", characterProhibitions: charProhibitionText },
    userPrompt: `请审阅以下章节：\n\n${content.slice(0, 8000)}`,
    schema: RawQualitySchema, temperature: 0.3,
  });

  // Rule-based prohibition scan (complementary to LLM review)
  const prohibitionViolations = scanProhibitionViolations(content, opts?.characterProhibitions);
  const llmIssues = (raw.issues ?? []).map(i => ({
    type: i.type ?? i.category ?? "一般",
    severity: normSeverity(i.severity),
    description: i.description ?? "",
    fixSuggestion: i.fixSuggestion ?? "",
  }));

  // Merge rule-based prohibition violations into issues
  const prohibitionIssues = prohibitionViolations.map(v => ({
    type: "角色硬约束违反",
    severity: "high" as const,
    description: `${v.characterName} 违反禁止项：「${v.prohibition}」`,
    fixSuggestion: `修改相关段落，确保 ${v.characterName} 不出现「${v.prohibition}」的行为。证据片段：${v.evidence}`,
  }));

  const qualityResult: QualityResult = {
    openingScore: raw.openingScore ?? 6,
    plotScore: raw.plotScore ?? 6,
    characterScore: raw.characterScore ?? 6,
    dialogueScore: raw.dialogueScore ?? 6,
    suspenseScore: raw.suspenseScore ?? 6,
    pacingScore: raw.pacingScore ?? 6,
    showNotTellScore: raw.showNotTellScore ?? 6,
    languageScore: raw.languageScore ?? 6,
    genreScore: raw.genreScore ?? 6,
    coherenceScore: raw.coherenceScore ?? 6,
    overallComment: raw.overallComment ?? raw.summary ?? raw.comment ?? "评估完成",
    verdict: "NEEDS_FIX",
    issues: [...prohibitionIssues, ...llmIssues],
  };

  // Skill diagnostics: enrich issues with rule-based Skill diagnostics for low-scoring dimensions
  qualityResult.issues = enrichQualityIssues(qualityResult);

  // Compute verdict from score and issues
  const total = totalQualityScore(qualityResult);
  const threshold = passThreshold(opts?.genre);
  const hasBlocking = (qualityResult.issues ?? []).some(i => i.severity === "high" && (i.type.includes("硬约束") || i.type.includes("违反")));
  const hasIssues = (qualityResult.issues ?? []).filter(i => i.severity === "high" || i.severity === "medium").length > 0;

  qualityResult.verdict = hasBlocking ? "BLOCKED"
    : total >= threshold && !hasIssues ? "PASS"
    : total >= threshold - 10 ? "WARNING"
    : "NEEDS_FIX";

  return qualityResult;
}

/** Calculate total score from quality result */
export function totalQualityScore(result: QualityResult): number {
  return (
    result.openingScore + result.plotScore + result.characterScore +
    result.dialogueScore + result.suspenseScore + result.pacingScore +
    result.showNotTellScore + result.languageScore + result.genreScore +
    result.coherenceScore
  );
}

/** Get the PASS threshold for a given genre — 10 dimensions, max 100 */
export function passThreshold(genre?: string | null): number {
  const cat = classifyGenre(genre);
  if (cat === "悬疑" || cat === "奇幻") return 65; // 10 dimensions × ~6.5
  return 60; // 10 dimensions × 6
}

/** Get genre score dimension labels for UI display */
export function genreDimensionLabels(genre?: string | null): string[] {
  return genreScoreLabels(classifyGenre(genre));
}
