/**
 * Quality Diagnostics — Skill法则 → 人话诊断翻译层.
 *
 * When a quality dimension scores below threshold, this module enriches
 * the review result with specific, actionable diagnostics derived from
 * the Skill's creative writing principles.
 *
 * Design principle (from CLAUDE.md):
 *   "质检双通道：结构化数据（给修复链路）+ 人话摘要（给用户阅读）"
 */

import type { QualityResult } from "./qualityGate";

export interface DiagnosticItem {
  /** Which dimension this targets */
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

// ─── Dimension diagnostic library (compiled from Skill guides) ──

const DIAGNOSTICS: Record<string, DiagnosticItem[]> = {
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
};

// ─── Main entry ──────────────────────────────────────

/** Threshold below which diagnostics are triggered */
const DIAGNOSTIC_THRESHOLD = 6;

/**
 * Generate Skill-based diagnostics for low-scoring dimensions.
 * Only dimensions that score below threshold get diagnostics.
 * At most 3 diagnostics per dimension to avoid overwhelming the author.
 */
export function generateDiagnostics(result: QualityResult): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  const scoreMap: Record<string, number> = {
    opening: result.openingScore,
    plot: result.plotScore,
    character: result.characterScore,
    dialogue: result.dialogueScore,
    suspense: result.suspenseScore,
    pacing: result.pacingScore,
    showNotTell: result.showNotTellScore,
    language: result.languageScore,
  };

  for (const [dimKey, score] of Object.entries(scoreMap)) {
    if (score >= DIAGNOSTIC_THRESHOLD) continue;
    const rules = DIAGNOSTICS[dimKey];
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
): Array<{ type: string; severity: string; description: string; fixSuggestion: string }> {
  const skillDiags = generateDiagnostics(result);

  const skillIssues = skillDiags.map(d => ({
    type: d.dimension,
    severity: "medium" as const,
    description: d.symptom,
    fixSuggestion: `${d.fix}${d.example ? `\n示例：${d.example}` : ""}`,
  }));

  const existingIssues = (result.issues ?? []).filter(
    i => !skillIssues.some(s => s.description === i.description), // dedup
  );

  return [...skillIssues, ...existingIssues];
}
