import { z } from "zod";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { QUALITY_DIMENSIONS, SCORE_FIELD_NAMES, DIMENSION_CATEGORY, DIAGNOSTIC_CATEGORY } from "@one2novel/shared/types/qualityDimensions";
import { QUALITY_PASS_THRESHOLD_STANDARD, QUALITY_PASS_THRESHOLD_STRICT, QUALITY_WARNING_DELTA, REF_PROMPT_SLICE_LARGE } from "../../../../platform/config/constants";

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

/** Five dimensions aligned with wNW reviewer — used for dimension_results */
const REVIEWER_DIMENSIONS = ["setting", "timeline", "continuity", "character", "logic"] as const;

export interface QualityResult {
  openingScore: number; plotScore: number; characterScore: number;
  dialogueScore: number; suspenseScore: number; pacingScore: number;
  showNotTellScore: number;  // Skill三大黄金法则之一
  languageScore: number; genreScore: number;
  coherenceScore: number;   // 跨章连贯性
  overallComment: string;
  verdict: Verdict;
  issues?: Array<{
    type: string;
    severity: "low" | "medium" | "high";
    description: string;
    fixSuggestion: string;
    category?: string;  // setting | timeline | continuity | character | logic | pacing | style
    evidence?: string;  // 原文引用
    blocking?: boolean; // 是否阻断写作
    location?: string;  // 段落/行号定位
  }>;
  /** 5-dimension pass/fail conclusions aligned with wNW reviewer schema */
  dimensionResults?: Array<{
    dimension: "setting" | "timeline" | "continuity" | "character" | "logic";
    conclusion: string; // "pass" or "发现N个问题：简述"
    issueCount: number;
  }>;
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
  /** Character state snapshot from previous chapter for continuity check */
  characterStateSnapshot?: string | null;
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

// ═══════════════════════════════════════════════════════
// Skill Diagnostics (merged from qualityDiagnostics.ts)
// ═══════════════════════════════════════════════════════

/** Threshold below which diagnostics are triggered */
const DIAGNOSTIC_THRESHOLD = 6;

interface DiagnosticRule {
  /** Which dimension this targets (diagnosticGroup name) */
  dimension: string;
  /** Symptom — what went wrong, in author language */
  symptom: string;
  /** Fix suggestion — specific, actionable */
  fix: string;
  /** Example of the fix applied */
  example?: string;
  /** Reference to the Skill principle */
  principle: string;
}

/**
 * Skill-based diagnostic library — compiled from writing Skill guides.
 * Covers all 10 dimensions. New dimensions added here automatically
 * get diagnostics via generateDiagnostics().
 */
const DIAGNOSTICS_DATA: Record<string, DiagnosticRule[]> = {
  opening: [
    {
      dimension: "开头吸引力",
      symptom: "开头使用了天气描写、日常流程或背景说明",
      fix: "直接从冲突或动作开始。删除前三段的铺垫，把最紧张的那一刻挪到开头",
      example: "不要写『那天天气晴朗』，写『子弹擦过他的耳边，击碎了身后的花瓶』",
      principle: "开头六种致命错误 · 十种强力开头技巧",
    },
    {
      dimension: "开头吸引力",
      symptom: "开头前 200 字没有建立紧张感或好奇心",
      fix: "用反常情境、震撼对话或倒计时开场立即抓住读者",
      example: "『全城的花在同一秒枯萎。只有云墨知道这意味着什么——封印破了。』",
      principle: "十种强力开头技巧",
    },
    {
      dimension: "开头吸引力",
      symptom: "开头回顾了上一章内容",
      fix: "删除所有『上一章说到』『此前』等回顾性文字。用角色的即时感知自然衔接",
      example: "不要写『上一章他逃出了监狱』，写『铁门在他身后关上，冷风灌进他的衣领』",
      principle: "开头致命错误 · 连贯性保证",
    },
  ],

  plot: [
    {
      dimension: "情节推进",
      symptom: "本章没有实质性的状态变化",
      fix: "确保本章至少改变以下一项：角色处境、人物关系、已知信息、冲突等级、资源状态",
      principle: "三大黄金法则 · 冲突驱动剧情",
    },
    {
      dimension: "情节推进",
      symptom: "本章事件可用一句话概括，缺乏层次",
      fix: "本章应包含 2-3 个事件，形成「推进→受阻→突破」的微结构",
      principle: "章节结构 · 防注水原则",
    },
  ],

  character: [
    {
      dimension: "人物塑造",
      symptom: "角色性格通过直接标签陈述（『他很聪明』『她很善良』），而非通过行动展示",
      fix: "删除直接陈述。用角色的选择、习惯、对话来表现性格",
      example: "不写『他很聪明』，写『他用三分钟解出了别人花一小时也算不对的题，然后继续吃泡面』",
      principle: "展示而非讲述 · 侧面揭示技法",
    },
    {
      dimension: "人物塑造",
      symptom: "角色行为前后不一致，或行为缺乏动机",
      fix: "检查角色在本章的行为是否与其已建立的性格、目标和缺陷一致",
      principle: "人物状态跟踪 · 矛盾创造深度",
    },
  ],

  dialogue: [
    {
      dimension: "对话质量",
      symptom: "对话缺乏目的——既不推动情节也不揭示人物",
      fix: "每段对话至少完成以下之一：推动情节、揭示人物、制造冲突、传达信息、制造悬念。删除纯寒暄",
      example: "删除『你好』『吃了吗』『天气不错』——改为沉默、动作或直奔主题",
      principle: "对话核心原则：每句必须有目的",
    },
    {
      dimension: "对话质量",
      symptom: "对话标签滥用副词（『他愤怒地说』『她温柔地回答』）",
      fix: "用角色的动作和语气本身传达情绪，删除对话标签中的副词",
      example: "『他愤怒地说：够了』→『他一拳砸在桌上。『够了。』』",
      principle: "对话写作规范 · 潜台词技法",
    },
    {
      dimension: "对话质量",
      symptom: "对话过于直白，缺乏潜台词",
      fix: "让角色不直接说出真实想法。用转移话题、反问、沉默代替正面回答",
      example: "不写『我爱你』，写『你今天穿的是我送的那件外套。』『是。』『旧了。』『我知道。』",
      principle: "潜台词技法",
    },
  ],

  suspense: [
    {
      dimension: "悬念设置",
      symptom: "章尾缺乏悬念钩子——读者可以放下书而不急于看下一章",
      fix: "章尾使用以下一种钩子：揭示一个秘密但留下更大谜团、角色做出不可逆决定、新危机突然出现、关系发生意外转折",
      principle: "悬念钩子十三式 · 三大黄金法则",
    },
    {
      dimension: "悬念设置",
      symptom: "章尾钩子是虚假悬念（机械误会、无意义的『突然』）",
      fix: "确保钩子与主线剧情有逻辑关联，读者回头看时能发现线索",
      principle: "悬念编排策略 · 打破读者预期",
    },
  ],

  pacing: [
    {
      dimension: "节奏控制",
      symptom: "连续三段以上句子长度相同或段落长度相同",
      fix: "检查全章：连续三句同长度必须打破。动作场景用短句（<10字），思考场景可放缓",
      principle: "长短句交替 · 段落呼吸",
    },
    {
      dimension: "节奏控制",
      symptom: "全程均匀节奏——没有高潮低谷交替",
      fix: "全章应包含 2-3 个张力波峰。标记每段的『速度』（快/中/慢），画节奏曲线，如果是一条直线则需调整",
      principle: "信息密度波浪 · 全章节奏检查法",
    },
  ],

  showNotTell: [
    {
      dimension: "展示而非讲述",
      symptom: "直接陈述了角色的情绪（『他很愤怒』『她很伤心』『他很紧张』）",
      fix: "用身体反应、动作和对话间接表现情绪",
      example: "『他很愤怒』→『他握紧拳头，指节发白，一言不发地转身离开』",
      principle: "三大黄金法则之首：展示而非讲述",
    },
    {
      dimension: "展示而非讲述",
      symptom: "用抽象形容词总结了场景或人物（『房间很乱』『她很美丽』）",
      fix: "用具体细节代替形容词——让读者自己得出结论",
      example: "『房间很乱』→『衣服扔在沙发上，外卖盒堆在桌上，窗帘只拉开了一半』",
      principle: "展示而非讲述 · 白描技法",
    },
    {
      dimension: "展示而非讲述",
      symptom: "关键场景被一笔带过——本该展示的时刻被总结替代",
      fix: "识别本章最重要的场景，逐帧描写：动作→感官→心理反应→后果。把一秒拆成三秒写",
      principle: "关键时刻放慢（子弹时间）",
    },
  ],

  language: [
    {
      dimension: "语言质量",
      symptom: "使用 AI 高频词汇：『璀璨』『心潮澎湃』『油然而生』『不禁』『仿佛』『此情此景』",
      fix: "逐词替换为具体的、有画面感的描写",
      principle: "AI 写作痕迹清除 · 用词精确",
    },
    {
      dimension: "语言质量",
      symptom: "连续使用两个以上四字成语（成语堆砌）",
      fix: "至少将其中一半展开为具体描写或对话",
      example: "『他心潮澎湃热血沸腾』→『他深吸一口气，手在微微发抖。多年的努力，今天终于有了结果。』",
      principle: "四字成语堆砌规则 · 白描技法",
    },
    {
      dimension: "语言质量",
      symptom: "段落结尾出现总结、升华或说教（『这一天的经历让他……』『通过这次……』）",
      fix: "删除总结句。让剧情本身传达意义，不要替读者总结",
      principle: "AI 写作痕迹清除 · 留白技法",
    },
  ],

  genre: [
    {
      dimension: "题材适配",
      symptom: "叙事风格与题材预期不符",
      fix: "检查目标读者的类型期待，确保叙事方式匹配",
      principle: "题材适配原则",
    },
  ],

  coherence: [
    {
      dimension: "跨章连贯",
      symptom: "本章与上一章的情节/状态存在断层",
      fix: "检查角色状态、场景、未解决冲突是否在下一章延续",
      principle: "连贯性保证",
    },
  ],
};

/**
 * Build score map from QUALITY_DIMENSIONS — guarantees all 10 dims are covered.
 */
function buildScoreMap(result: QualityResult): Record<string, number> {
  const map: Record<string, number> = {};
  for (const dim of QUALITY_DIMENSIONS) {
    map[dim.key] = (result as unknown as Record<string, number>)[dim.scoreField] ?? 0;
  }
  return map;
}

/**
 * Generate Skill-based diagnostics for low-scoring dimensions.
 * Only dimensions that score below threshold get diagnostics.
 * At most 2 diagnostics per dimension to avoid overwhelming the author.
 */
function generateDiagnostics(result: QualityResult): Array<{
  dimension: string;
  symptom: string;
  fix: string;
  example?: string;
  principle: string;
}> {
  const scoreMap = buildScoreMap(result);
  const diagnostics: Array<{
    dimension: string;
    symptom: string;
    fix: string;
    example?: string;
    principle: string;
  }> = [];

  for (const [dimKey, score] of Object.entries(scoreMap)) {
    if (score >= DIAGNOSTIC_THRESHOLD) continue;
    const rules = DIAGNOSTICS_DATA[dimKey];
    if (!rules || rules.length === 0) continue;

    // Pick the most relevant diagnostics (up to 2 per dimension)
    const selected = rules.slice(0, 2);
    diagnostics.push(...selected);
  }

  return diagnostics;
}

/**
 * Merge Skill-based diagnostics into the LLM-generated issues list.
 * Skill diagnostics come first (rule-based, reliable) → LLM issues follow (context-specific).
 */
export function enrichQualityIssues(
  result: QualityResult,
): Array<{
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  fixSuggestion: string;
  category?: string;
}> {
  const skillDiags = generateDiagnostics(result);

  const skillIssues = skillDiags.map(d => ({
    type: d.dimension,
    severity: "medium" as const,
    description: d.symptom,
    fixSuggestion: `${d.fix}${d.example ? `\n示例：${d.example}` : ""}`,
    category: DIAGNOSTIC_CATEGORY[d.dimension] ?? "logic",
  }));

  const existingIssues = (result.issues ?? []).filter(
    i => !skillIssues.some(s => s.description === i.description), // dedup
  );

  return [...skillIssues, ...existingIssues];
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
    userPrompt: [
      `请审阅以下章节：\n\n${content.slice(0, REF_PROMPT_SLICE_LARGE)}`,
      opts?.characterStateSnapshot ? `\n上一章结束时角色状态（请检查本章是否保持一致）：\n${opts.characterStateSnapshot}` : "",
    ].join("\n"),
    schema: RawQualitySchema, temperature: 0.3,
  });

  // Rule-based prohibition scan (complementary to LLM review)
  const prohibitionViolations = scanProhibitionViolations(content, opts?.characterProhibitions);
  const llmIssues = (raw.issues ?? []).map((i: Record<string, unknown>) => ({
    type: (i.type ?? i.category ?? "一般") as string,
    severity: normSeverity(i.severity as string | undefined),
    description: (i.description ?? "") as string,
    fixSuggestion: (i.fixSuggestion ?? "") as string,
    category: (i.category ?? "logic") as string,
    evidence: (i.evidence as string) ?? undefined,
    blocking: false,
    location: (i.location as string) ?? undefined,
  }));

  // Merge rule-based prohibition violations into issues
  const prohibitionIssues = prohibitionViolations.map(v => ({
    type: "角色硬约束违反",
    severity: "high" as const,
    description: `${v.characterName} 违反禁止项：「${v.prohibition}」`,
    fixSuggestion: `修改相关段落，确保 ${v.characterName} 不出现「${v.prohibition}」的行为。证据片段：${v.evidence}`,
    category: "logic",
    evidence: v.evidence,
    blocking: true,
    location: v.characterName,
  }));

  const allIssues = [...prohibitionIssues, ...llmIssues];

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
    issues: allIssues,
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
    : total >= threshold - QUALITY_WARNING_DELTA ? "WARNING"
    : "NEEDS_FIX";

  // Build dimension_results aligned with wNW reviewer schema
  qualityResult.dimensionResults = buildDimensionResults(qualityResult);

  return qualityResult;
}

/**
 * Build 5-dimension pass/fail conclusions aligned with wNW reviewer schema.
 * Maps qualityGate dimensions → 5 reviewer categories.
 */
function buildDimensionResults(result: QualityResult): typeof result.dimensionResults {
  const issues = result.issues ?? [];

  // Count issues per category
  const categoryCounts: Record<string, number> = {};
  const categoryDescriptions: Record<string, string[]> = {};
  for (const issue of issues) {
    const cat = issue.category ?? "logic";
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    if (!categoryDescriptions[cat]) categoryDescriptions[cat] = [];
    const desc = issue.description?.slice(0, 60);
    if (desc && !categoryDescriptions[cat].includes(desc)) {
      categoryDescriptions[cat].push(desc);
    }
  }

  // Map qualityGate dimensions to reviewer categories — derived from QUALITY_DIMENSIONS
  const dimMap: Record<string, string> = {};
  for (const dim of QUALITY_DIMENSIONS) {
    if (dim.category !== "style") {
      dimMap[dim.scoreField] = dim.category;
    }
  }

  // Build dimension_results
  const dimResults = REVIEWER_DIMENSIONS.map(dim => {
    // Find all qualityGate dimensions that map to this category
    const relatedScores = Object.entries(dimMap)
      .filter(([, cat]) => cat === dim)
      .map(([scoreKey]) => scoreKey as keyof Pick<typeof result, "genreScore" | "coherenceScore" | "characterScore" | "dialogueScore" | "plotScore" | "suspenseScore">);

    // Check if any related score is below threshold
    const isLow = relatedScores.some(sk => (result[sk] ?? 10) < 6);
    const count = categoryCounts[dim] ?? 0;

    let conclusion: string;
    if (count === 0 && !isLow) {
      conclusion = "pass";
    } else if (count > 0) {
      const samples = (categoryDescriptions[dim] ?? []).slice(0, 2).join("；");
      conclusion = `发现${count}个问题：${samples || dim + "维度存在问题"}`;
    } else {
      conclusion = `潜在${dim}问题（相关维度评分偏低）`;
    }

    return { dimension: dim, conclusion, issueCount: count };
  });

  return dimResults;
}

/** Calculate total score from quality result — iterates all 10 dimensions */
export function totalQualityScore(result: QualityResult): number {
  return SCORE_FIELD_NAMES.reduce<number>((sum, field) => sum + ((result as unknown as Record<string, number>)[field] ?? 0), 0);
}

/** Get the PASS threshold for a given genre — 10 dimensions, max 100 */
export function passThreshold(genre?: string | null): number {
  const cat = classifyGenre(genre);
  if (cat === "悬疑" || cat === "奇幻") return QUALITY_PASS_THRESHOLD_STRICT;
  return QUALITY_PASS_THRESHOLD_STANDARD;
}

/** Get genre score dimension labels for UI display */
export function genreDimensionLabels(genre?: string | null): string[] {
  return genreScoreLabels(classifyGenre(genre));
}
