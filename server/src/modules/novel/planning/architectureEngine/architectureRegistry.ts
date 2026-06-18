/**
 * Architecture Registry — predefined loop-based architecture templates for long-form novels.
 * Each template encodes: loop phases, default cool-point recipe, hook profile, settlement types.
 *
 * Also provides toArchitectureProfile() to convert templates into the unified ArchitectureProfile
 * format — the same format produced by reference book analysis and user customization.
 */
import type { ArchitectureTemplate, ArchitectureType } from "./types";
import type { ArchitectureProfile, LoopPhase } from "@one2novel/shared/types/architectureProfile";

const SKILL_SLOT_TEMPLATE: ArchitectureTemplate = {
  id: "skill_slot",
  name: "技能栏搭配",
  description: "世界给所有超凡力量加了一把「格子锁」。主角拥有更多槽位或自由选择能力，每一次「开奖」获得新技能都让读者兴奋，每一次搭配验证都制造爽点。",
  compatibleGenres: ["奇幻", "科幻", "都市", "游戏"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "触发事件",
        description: "新的秘境/遗迹/副本被发现或开启，主角获得进入资格",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "enter", label: "进入探索",
        description: "主角进入副本，开始探索未知区域，收集线索和资源",
        typicalChapterCount: [2, 4],
      },
      {
        phase: "explore", label: "深入展开",
        description: "副本内部展开，遭遇挑战、收集材料、发现隐藏线索",
        typicalChapterCount: [3, 5],
      },
      {
        phase: "setback", label: "受挫考验",
        description: "遭遇重大阻碍——强敌、陷阱、规则反转，主角面临失败风险",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "turn", label: "转折翻盘",
        description: "主角利用已有技能巧妙组合/新获得的技能/策略推演实现逆转",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "climax", label: "决战高潮",
        description: "与最大威胁展开最终对抗，验证新技能搭配的威力",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "settlement", label: "结算收获",
        description: "获得新技能/新装备/新信息，明确下一轮回环的升级方向",
        typicalChapterCount: [1, 2],
      },
    ],
    estimatedChaptersPerLoop: [10, 18],
    settlementTypes: ["新技能", "技能合成", "装备升级", "新宠物", "隐藏信息", "传承碎片"],
    scaleUpDirections: [
      "副本层级提升（普通秘境→上古遗迹→神之领域）",
      "敌人强度升级（同阶→越阶→跨境界→位面级）",
      "技能维度扩展（单技能→技能组合→技能融合→领域展开）",
      "舞台范围扩大（个人→团队→势力→世界→位面）",
    ],
  },
  defaultCoolPointRecipe: { collect: 30, strategy: 25, verify: 20, reveal: 15, upgrade: 10 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 3, longTermLines: 4 },
  defaultContentBeats: {
    修炼: { pct: 25, span: "2-4章", label: "修炼" },
    显圣: { pct: 20, span: "1-2章", label: "显圣" },
    赚钱: { pct: 15, span: "1-2章", label: "赚钱" },
    日常: { pct: 15, span: "1-2章", label: "日常" },
    恋爱: { pct: 10, span: "1章", label: "恋爱" },
    过渡: { pct: 10, span: "1章", label: "过渡" },
    说明: { pct: 5, span: "1章", label: "说明" },
  },
  representativeWorks: ["《不科学御兽》", "《全职高手》", "《超神机械师》"],
};

const SEQUENCE_PROMOTION_TEMPLATE: ArchitectureTemplate = {
  id: "sequence_promotion",
  name: "序列晋升",
  description: "世界把力量体系做成了「职业树」。每一级序列晋升都是一场仪式——收集材料→完成仪式→解锁新能力。晋升不是数值提升，而是行为艺术。",
  compatibleGenres: ["奇幻", "悬疑", "科幻", "都市"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "触发事件",
        description: "主角得知晋升下一序列所需的条件或材料线索",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "enter", label: "搜集准备",
        description: "搜集晋升材料、破解晋升条件、准备仪式场所",
        typicalChapterCount: [3, 5],
      },
      {
        phase: "explore", label: "考验展开",
        description: "材料争夺、情报博弈、与其他序列者的冲突",
        typicalChapterCount: [3, 5],
      },
      {
        phase: "setback", label: "受挫考验",
        description: "材料被夺、仪式被干扰、扮演出现偏差、面临失控风险",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "turn", label: "转折翻盘",
        description: "发现隐藏条件、利用信息差逆转、完成关键扮演",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "climax", label: "晋升仪式",
        description: "完成晋升仪式，消化魔药/突破序列，获得全新能力体系",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "settlement", label: "结算收获",
        description: "掌握新序列能力，确认下一序列的晋升线索，建立新身份",
        typicalChapterCount: [1, 2],
      },
    ],
    estimatedChaptersPerLoop: [12, 20],
    settlementTypes: ["新序列等级", "新能力体系", "隐藏知识", "身份晋升", "组织地位", "锚定物"],
    scaleUpDirections: [
      "序列层级提升（低序列→中序列→高序列→天使→真神）",
      "扮演深度增加（表面扮演→深度扮演→身份融合→保持人性）",
      "敌人维度升级（同序列→高序列→跨途径→旧日/外神）",
      "舞台范围扩大（个人→组织→教会→国家→文明→宇宙）",
    ],
  },
  defaultCoolPointRecipe: { collect: 20, strategy: 30, verify: 15, reveal: 25, upgrade: 10 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 4, longTermLines: 5 },
  defaultContentBeats: {
    调查: { pct: 25, span: "2-4章", label: "调查" },
    显圣: { pct: 20, span: "1-2章", label: "显圣" },
    修炼: { pct: 15, span: "2-3章", label: "修炼" },
    说明: { pct: 15, span: "1-2章", label: "说明" },
    日常: { pct: 10, span: "1章", label: "日常" },
    过渡: { pct: 10, span: "1章", label: "过渡" },
    赚钱: { pct: 5, span: "1章", label: "赚钱" },
  },
  representativeWorks: ["《诡秘之主》", "《深海余烬》", "《道诡异仙》"],
};

const CASE_DRIVEN_TEMPLATE: ArchitectureTemplate = {
  id: "case_driven",
  name: "超凡办案",
  description: "世界有一个超越世俗权力的「超凡执法机构」。主角是体制内成员，每个案件都是单元剧容器，案件背后指向同一个核心阴谋。破案=功绩=资源+晋升。",
  compatibleGenres: ["悬疑", "都市", "奇幻", "历史"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "接案/任务下达",
        description: "上级分配案件/巡逻发现异常/委托人上门，主角被卷入新事件",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "enter", label: "初步调查",
        description: "勘察现场、收集证据、走访证人、发现超凡痕迹",
        typicalChapterCount: [2, 4],
      },
      {
        phase: "explore", label: "深入追踪",
        description: "追踪线索、发现嫌疑人、遭遇超凡存在、卷入更大阴谋",
        typicalChapterCount: [3, 5],
      },
      {
        phase: "setback", label: "受挫考验",
        description: "关键证人死亡、证据被销毁、上级施压、真凶误导调查方向",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "turn", label: "关键突破",
        description: "发现被忽略的线索、利用超凡手段获取关键证据、推理出真相",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "climax", label: "收网对抗",
        description: "与真凶正面交锋，案件真相大白，揭示更深层的阴谋线索",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "settlement", label: "结算复盘",
        description: "案件归档、功绩评定、官职/序列晋升、获得新资源，发现下一案件线索",
        typicalChapterCount: [1, 2],
      },
    ],
    estimatedChaptersPerLoop: [10, 18],
    settlementTypes: ["功绩晋升", "新权限", "新情报网", "新装备", "政治资本", "隐藏真相碎片"],
    scaleUpDirections: [
      "官职梯队提升（铜锣→银锣→金锣→指挥使→机构首领）",
      "案件复杂度升级（独立案件→连环案件→跨区域案件→涉及最高层的阴谋）",
      "权限范围扩大（街区→城区→整个王朝→多国→位面）",
      "真相深度递进（表面案件→中层腐败→高层阴谋→世界规则级别的真相）",
    ],
  },
  defaultCoolPointRecipe: { collect: 15, strategy: 20, verify: 15, reveal: 35, upgrade: 15 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 3, longTermLines: 4 },
  defaultContentBeats: {
    调查: { pct: 30, span: "2-4章", label: "调查" },
    显圣: { pct: 20, span: "1-2章", label: "显圣" },
    推理: { pct: 15, span: "1-2章", label: "推理" },
    日常: { pct: 15, span: "1章", label: "日常" },
    赚钱: { pct: 10, span: "1章", label: "赚钱" },
    过渡: { pct: 5, span: "1章", label: "过渡" },
    说明: { pct: 5, span: "1章", label: "说明" },
  },
  representativeWorks: ["《大奉打更人》", "《警探长》", "《我有一座恐怖屋》"],
};

const CULTIVATION_PLANNING_TEMPLATE: ArchitectureTemplate = {
  id: "cultivation_planning",
  name: "修真规划",
  description: "修行境界+辅修技能，资源有限时间有限，主角用金手指放大资源，以完美姿态突破每一境界。每一步都算无遗策，每一张底牌都能让敌人绝望。",
  compatibleGenres: ["仙侠", "修真", "奇幻", "古典仙侠"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "机缘触发",
        description: "发现秘境/古修遗迹/灵药产地，或从敌人手中夺得关键线索",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "enter", label: "搜集准备",
        description: "收集突破材料、炼制丹药、准备后手、布置阵法",
        typicalChapterCount: [3, 6],
      },
      {
        phase: "explore", label: "探索考验",
        description: "秘境探索、材料争夺、势力博弈、应对觊觎者",
        typicalChapterCount: [4, 6],
      },
      {
        phase: "setback", label: "受挫考验",
        description: "材料不足/强敌抢夺/突破瓶颈/心魔作祟",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "turn", label: "关键突破",
        description: "利用底牌/后手逆转，完成关键突破条件，准备渡劫",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "climax", label: "境界突破",
        description: "正式突破大境界，天劫/心魔考验，新能力觉醒",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "settlement", label: "结算巩固",
        description: "稳固境界、炼制新法宝、培育灵虫、规划下一境界的辅修路线",
        typicalChapterCount: [1, 3],
      },
    ],
    estimatedChaptersPerLoop: [15, 25],
    settlementTypes: ["新境界", "本命法宝", "灵虫进化", "秘术", "丹方", "阵法", "新傀儡"],
    scaleUpDirections: [
      "境界提升（筑基→结丹→元婴→化神→炼虚→合体→大乘→渡劫）",
      "辅修维度扩展（炼丹→炼器→阵法→符箓→傀儡→御兽→御虫）",
      "舞台范围扩大（宗门→国家→大陆→人界→灵界→仙界）",
    ],
  },
  defaultCoolPointRecipe: { collect: 25, strategy: 30, verify: 20, reveal: 15, upgrade: 10 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 3, longTermLines: 5 },
  defaultContentBeats: {
    修炼: { pct: 35, span: "2-5章", label: "修炼" },
    显圣: { pct: 20, span: "1-2章", label: "显圣" },
    赚钱: { pct: 15, span: "1-2章", label: "赚钱" },
    日常: { pct: 10, span: "1章", label: "日常" },
    恋爱: { pct: 5, span: "1章", label: "恋爱" },
    过渡: { pct: 10, span: "1章", label: "过渡" },
    说明: { pct: 5, span: "1章", label: "说明" },
  },
  representativeWorks: ["《凡人修仙传》", "《遮天》", "《仙逆》"],
};

const HISTORICAL_TRANSMIGRATION_TEMPLATE: ArchitectureTemplate = {
  id: "historical_transmigration",
  name: "穿越历史",
  description: "前世知识+金手指，从个人生存到改变历史再到社会实验。五级递进舞台：生存→崛起→改变→扩张→实验，每一步都把舞台放大一个数量级。",
  compatibleGenres: ["历史", "都市", "科幻"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "时代切入",
        description: "穿越到特定历史节点，面临生存危机，利用知识差获得立足之地",
        typicalChapterCount: [2, 4],
      },
      {
        phase: "enter", label: "立足扎根",
        description: "利用前世知识（酒/皂/诗/商/科）获取第一桶金，建立初步的人际网络与势力基础",
        typicalChapterCount: [4, 8],
      },
      {
        phase: "explore", label: "势力扩张",
        description: "参与权力斗争、商业竞争、小规模战争，结交盟友，对抗地方势力",
        typicalChapterCount: [5, 8],
      },
      {
        phase: "setback", label: "历史惯性",
        description: "遭遇历史既定趋势的反弹、保守势力反扑、外部强敌入侵",
        typicalChapterCount: [2, 4],
      },
      {
        phase: "turn", label: "破局突破",
        description: "金手指+知识差+势力和武力结合，强行改写局部历史走向",
        typicalChapterCount: [2, 4],
      },
      {
        phase: "climax", label: "时代决战",
        description: "决定性战役/政变/革命，彻底改变历史进程，外御强敌/内惩国贼",
        typicalChapterCount: [2, 5],
      },
      {
        phase: "settlement", label: "文明重建",
        description: "推广科技/制度，国富民强，规划下一阶段扩张方向（欧/亚/美/太空）",
        typicalChapterCount: [2, 4],
      },
    ],
    estimatedChaptersPerLoop: [20, 35],
    settlementTypes: ["科技突破", "政治改革", "军事胜利", "经济垄断", "文化传播"],
    scaleUpDirections: [
      "个人生存→家族崛起→地方势力→国家政权→文明扩张→社会实验",
    ],
  },
  defaultCoolPointRecipe: { collect: 15, strategy: 20, verify: 15, reveal: 20, upgrade: 30 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 4, longTermLines: 4 },
  defaultContentBeats: {
    显圣: { pct: 25, span: "1-3章", label: "显圣" },
    赚钱: { pct: 15, span: "1-2章", label: "赚钱" },
    修炼: { pct: 15, span: "2-3章", label: "修炼" },
    日常: { pct: 15, span: "1-2章", label: "日常" },
    恋爱: { pct: 10, span: "1章", label: "恋爱" },
    过渡: { pct: 10, span: "1章", label: "过渡" },
    说明: { pct: 10, span: "1-2章", label: "说明" },
  },
  representativeWorks: ["《赘婿》", "《庆余年》", "《新宋》"],
};

// ─── Registry ──────────────────────────────────────────

const HEXAGON_GODHOOD_TEMPLATE: ArchitectureTemplate = {
  id: "hexagon_godhood",
  name: "六边形成神",
  description: "主角不能有任何短板。精神/物理/魔法/召唤/财富/权力——逐维度补全，从泥泞中一步步爬上神座。文笔藏架构，让读者忘记他在'补属性'。",
  compatibleGenres: ["奇幻", "史诗奇幻", "西幻", "黑暗奇幻"],
  defaultLoop: {
    phases: [
      {
        phase: "trigger", label: "困境暴露",
        description: "主角的某个维度短板被敌人利用，导致重大损失或羞辱",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "enter", label: "资源搜集",
        description: "寻找补强该维度的资源/导师/机缘，布局算计",
        typicalChapterCount: [3, 6],
      },
      {
        phase: "explore", label: "势力博弈",
        description: "利用现有优势维度参与博弈，获取目标资源的过程中遭遇多方势力干涉",
        typicalChapterCount: [4, 7],
      },
      {
        phase: "setback", label: "绝境反击",
        description: "被逼入绝境，旧短板仍在但新能力尚未成型，被迫用卑劣手段翻盘",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "turn", label: "维度过关",
        description: "通过吞噬/阴谋/交易获得该维度的突破性提升",
        typicalChapterCount: [1, 2],
      },
      {
        phase: "climax", label: "降维打击",
        description: "用新获得的维度能力碾压之前无法战胜的敌人，吞并其势力/财富/情报",
        typicalChapterCount: [1, 3],
      },
      {
        phase: "settlement", label: "消化整合",
        description: "整合新获得的势力、财富、情报，确认下一维度的短板",
        typicalChapterCount: [2, 4],
      },
    ],
    estimatedChaptersPerLoop: [15, 28],
    settlementTypes: ["新维度能力", "吞并的势力", "政治盟友", "神性碎片", "禁忌知识", "信仰锚点"],
    scaleUpDirections: [
      "维度补全顺序：武力→精神→魔法→召唤→财富→权力→神性",
    ],
  },
  defaultCoolPointRecipe: { collect: 20, strategy: 35, verify: 15, reveal: 20, upgrade: 10 },
  defaultHookProfile: { shortTermPerChapter: 1, mediumTermPerVolume: 3, longTermLines: 4 },
  defaultContentBeats: {
    修炼: { pct: 20, span: "2-4章", label: "修炼" },
    显圣: { pct: 20, span: "1-2章", label: "显圣" },
    赚钱: { pct: 15, span: "1-2章", label: "赚钱" },
    日常: { pct: 15, span: "1-2章", label: "日常" },
    恋爱: { pct: 10, span: "1章", label: "恋爱" },
    过渡: { pct: 10, span: "1章", label: "过渡" },
    说明: { pct: 10, span: "1章", label: "说明" },
  },
  representativeWorks: ["《亵渎》", "《佣兵天下》", "《紫川》"],
};

const registry = new Map<ArchitectureType, ArchitectureTemplate>([
  ["skill_slot", SKILL_SLOT_TEMPLATE],
  ["sequence_promotion", SEQUENCE_PROMOTION_TEMPLATE],
  ["case_driven", CASE_DRIVEN_TEMPLATE],
  ["cultivation_planning", CULTIVATION_PLANNING_TEMPLATE],
  ["historical_transmigration", HISTORICAL_TRANSMIGRATION_TEMPLATE],
  ["hexagon_godhood", HEXAGON_GODHOOD_TEMPLATE],
]);

export function getArchitectureTemplate(id: ArchitectureType): ArchitectureTemplate | undefined {
  return registry.get(id);
}

export function listArchitectureTemplates(): ArchitectureTemplate[] {
  return Array.from(registry.values());
}

export function getArchitectureTypeLabel(id: ArchitectureType): string {
  const t = registry.get(id);
  return t?.name ?? "自定义架构";
}

/** Build an ExpectationProfile JSON from the architecture template's defaults */
export function buildExpectationProfile(architectureType: ArchitectureType): string | null {
  const t = registry.get(architectureType);
  if (!t) return null;
  return JSON.stringify({
    coolPointRecipe: t.defaultCoolPointRecipe,
    hookProfile: t.defaultHookProfile,
    payoffWindow: 50,
  });
}

/** Convert a built-in ArchitectureTemplate to the unified ArchitectureProfile format */
export function toArchitectureProfile(t: ArchitectureTemplate): ArchitectureProfile {
  const beats: Record<string, number> = {};
  for (const [key, def] of Object.entries(t.defaultContentBeats ?? {})) {
    beats[key] = (def as { pct: number }).pct;
  }

  return {
    name: t.name,
    source: "builtin",
    loopPhases: t.defaultLoop.phases.map(p => ({
      phase: p.phase,
      label: p.label,
      description: p.description,
      typicalChapterRange: [p.typicalChapterCount[0], p.typicalChapterCount[1]],
    })),
    chapterTypeDistribution: {
      advance: 55, transition: 20, cooldown: 15, climax: 10,
    },
    avgChaptersPerLoop: {
      min: t.defaultLoop.estimatedChaptersPerLoop[0],
      max: t.defaultLoop.estimatedChaptersPerLoop[1],
      avg: Math.round((t.defaultLoop.estimatedChaptersPerLoop[0] + t.defaultLoop.estimatedChaptersPerLoop[1]) / 2),
    },
    avgChapterWordCount: { min: 2500, max: 4000, avg: 3000 },
    coolPointRecipe: {
      collect: t.defaultCoolPointRecipe.collect ?? 20,
      strategy: t.defaultCoolPointRecipe.strategy ?? 20,
      verify: t.defaultCoolPointRecipe.verify ?? 20,
      reveal: t.defaultCoolPointRecipe.reveal ?? 20,
      upgrade: t.defaultCoolPointRecipe.upgrade ?? 15,
      faceSlap: (t.defaultCoolPointRecipe as any).faceSlap ?? 5,
    },
    hookProfile: {
      shortTermPerChapter: t.defaultHookProfile.shortTermPerChapter ?? 1,
      mediumTermPerVolume: t.defaultHookProfile.mediumTermPerVolume ?? 3,
      longTermLines: t.defaultHookProfile.longTermLines ?? 4,
      hookDistribution: { suspense: 35, reversal: 25, preview: 25, emotional: 15 },
    },
    contentBeatProfile: beats,
    characterSystem: {
      avgTotal: 10,
      roleDistribution: { protagonist: 1, antagonist: 2, supporting: 4, minor: 3 },
      avgChaptersBetweenAppearances: 5,
      avgCharactersPerChapter: 3,
    },
    payoffPatterns: {
      avgSeedToPayoffChapters: 50,
      seedsPerVolume: 5,
      typicalPayoffWindow: 50,
    },
    writingTechniques: undefined,
  };
}
