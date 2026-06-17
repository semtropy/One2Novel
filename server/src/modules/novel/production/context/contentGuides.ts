/**
 * Content guides for chapter generation — loop phase instructions, reference book
 * style hints, reference counterpart mapping, and content beat writing guides.
 * Extracted from contextBlockBuilders.ts to keep each file single-responsibility.
 */
import { getPrisma } from "../../../../platform/db/client";

// ─── Loop Phase Writing Guide (Phase 2) ──────────────────

const LOOP_PHASE_GUIDES: Record<string, string> = {
  trigger: "本章处于「触发事件」阶段——应引入新的副本/任务/危机，建立本轮回环的驱动力。开头应快速进入情境，结尾暗示本轮的主要挑战。",
  enter: "本章处于「进入探索」阶段——主角进入新环境，应侧重感官描写和初步线索收集。为后续展开埋下伏笔，保持好奇心牵引。",
  explore: "本章处于「深入展开」阶段——副本内展开，应推进核心探索/调查。揭示部分信息但保留更大谜团，让读者持续猜测真相。",
  setback: "本章处于「受挫考验」阶段——主角遭遇重大阻碍或失败。应制造真实的威胁感和挫败感，但保留翻盘的希望。这是情绪曲线的低谷，应让读者担心主角。",
  turn: "本章处于「转折翻盘」阶段——局势逆转。主角利用已有资源/信息实现翻盘，应侧重策略推演或意外发现的快感。让读者感到「原来如此」。",
  climax: "本章处于「决战高潮」阶段——与最大威胁的最终对抗。应充分调动前面积累的所有线索和能力，给予读者最大程度的满足。节奏应快速、密集。",
  settlement: "本章处于「结算收获」阶段——胜负已分，进入收获和复盘。明确本轮回环的成果（新能力/新信息/新身份），同时暗示下一轮回环的方向。应为读者提供情绪缓冲和期待。",
};

export function getLoopPhaseGuide(
  loopPhase: string | null,
  chapterType: string | null,
  coolPointType: string | null,
): string | null {
  const guide = loopPhase ? LOOP_PHASE_GUIDES[loopPhase] : null;
  if (!guide) return null;

  const extras: string[] = [];
  if (chapterType === "climax") extras.push("本章被标记为高潮章，应全力推进剧情，保持高密度冲突。");
  if (chapterType === "cooldown") extras.push("本章是冷却章，应侧重情绪消化和角色互动，但不可完全停止推进。");
  if (chapterType === "transition") extras.push("本章是过渡章，可做日常/修炼/旅行描写，但结尾应有钩子。");
  if (coolPointType) extras.push(`本章预期爽点类型为「${coolPointType}」——确保正文中有对应的满足感。`);

  return extras.length > 0 ? `${guide} ${extras.join(" ")}` : guide;
}

// ─── Reference Style Hints (Phase 4) ─────────────────────

interface WritingTechnique {
  category: string;
  observation: string;
  rule: string;
  confidence: number;
}

interface WritingAssetCollection {
  overallStyleDescription: string;
  narrativeAssets: WritingTechnique[];
  languageAssets: WritingTechnique[];
  characterAssets: WritingTechnique[];
  rhythmAssets: WritingTechnique[];
  antiAiAssets: WritingTechnique[];
}

const CATEGORY_LABELS: Record<string, string> = {
  narrativeAssets: "叙事技法",
  languageAssets: "语言风格",
  characterAssets: "角色塑造",
  rhythmAssets: "节奏控制",
  antiAiAssets: "反AI特征",
};

export async function buildReferenceStyleHints(novelId: string): Promise<string | null> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({ where: { novelId } });
  if (!rb?.writingAssets) return null;

  let assets: WritingAssetCollection;
  try {
    assets = JSON.parse(rb.writingAssets) as WritingAssetCollection;
  } catch {
    return null;
  }

  const parts: string[] = [];

  // Overall style description
  if (assets.overallStyleDescription) {
    parts.push(`## 对标书风格参考\n\n**整体风格：** ${assets.overallStyleDescription}`);
  } else {
    parts.push("## 对标书风格参考");
  }

  // Top 2 techniques per category
  const categories: Array<{ key: keyof WritingAssetCollection; label: string }> = [
    { key: "narrativeAssets", label: "叙事技法" },
    { key: "languageAssets", label: "语言风格" },
    { key: "characterAssets", label: "角色塑造" },
    { key: "rhythmAssets", label: "节奏控制" },
    { key: "antiAiAssets", label: "反AI特征" },
  ];

  for (const { key, label } of categories) {
    const techniques = (assets[key] as WritingTechnique[] | undefined) ?? [];
    // Sort by confidence descending, take top 2
    const top2 = [...techniques]
      .filter(t => t.confidence >= 0.4)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2);

    if (top2.length > 0) {
      const rules = top2.map(t => `- ${t.rule}`).join("\n");
      parts.push(`### ${label}\n${rules}`);
    }
  }

  if (parts.length <= 1) return null; // Only the header, no techniques
  return parts.join("\n\n");
}

// ─── Reference Counterpart — maps current chapter to similar position in reference book ──

export async function buildReferenceCounterpart(novelId: string, chapterOrder: number): Promise<string | null> {
  const prisma = getPrisma();
  const rb = await prisma.referenceBook.findUnique({
    where: { novelId },
    select: { annotations: true, totalChapters: true, content: true },
  });
  if (!rb?.annotations || !rb?.totalChapters) return null;

  let annotations: {
    loopBoundaries?: Array<{ chapterIndex: number; type: "start" | "end" }>;
    highCoolChapters?: number[];
    coolPointDensity?: Array<{ chapterIndex: number; level: string }>;
  };
  try { annotations = JSON.parse(rb.annotations); } catch { return null; }

  // Find total chapters in current novel for proportional mapping
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { estimatedChapterCount: true, chapters: { select: { id: true } } },
  });
  const totalNovelChapters = novel?.estimatedChapterCount ?? novel?.chapters.length ?? 500;

  // Map current chapter order to reference book chapter index proportionally
  const refTotal = rb.totalChapters;
  const refChapterIndex = Math.max(1, Math.min(refTotal, Math.round((chapterOrder / totalNovelChapters) * refTotal)));

  // Find the loop this reference chapter belongs to
  const loops = annotations.loopBoundaries ?? [];
  const currentLoop = loops
    .filter(b => b.chapterIndex <= refChapterIndex && b.type === "start")
    .sort((a, b) => b.chapterIndex - a.chapterIndex)[0];

  const coolDensity = annotations.coolPointDensity ?? [];
  const nearbyCool = coolDensity.filter(
    c => c.chapterIndex >= refChapterIndex - 3 && c.chapterIndex <= refChapterIndex + 3
  );

  const parts: string[] = [];
  parts.push(`对标书位置映射：第${refChapterIndex}章/${refTotal}章`);

  if (currentLoop) {
    parts.push(`所在回环起点：第${currentLoop.chapterIndex}章`);
  }

  if (nearbyCool.length > 0) {
    const highCount = nearbyCool.filter(c => c.level === "high").length;
    const lowCount = nearbyCool.filter(c => c.level === "low").length;
    parts.push(`附近±3章爽点密度：${highCount}高/${nearbyCool.length - highCount - lowCount}中/${lowCount}低`);
  }

  // Get actual chapter snippet if content available
  if (rb.content) {
    const chapterHeadingMatch = rb.content.match(
      new RegExp(`(?:^|\\n)\\s*(?:第${refChapterIndex}[章節节]|Chapter\\s+${refChapterIndex})`, 'im')
    );
    if (chapterHeadingMatch) {
      const start = chapterHeadingMatch.index!;
      const snippet = rb.content.slice(start, start + 500).replace(/\n/g, " ");
      parts.push(`对标书同位置章节开头：${snippet}...`);
    }
  }

  return parts.join("\n");
}

// ─── Content Beat Writing Guide ──────────────────────────

const CONTENT_BEAT_GUIDES: Record<string, string> = {
  修炼: "侧重功法领悟的顿悟感、资源消耗的紧张感、突破前后的身体变化描写。避免纯'打坐→升级'的流水账，要写出每次修炼的具体目标和代价。",
  显圣: "制造信息差——读者知道主角有多强但对手不知道。打脸要有铺垫（对手的轻视）→执行（主角碾压）→反应（众人震惊）三段式。避免直接陈述'他很厉害'，要通过旁观者视角侧写。",
  赚钱: "每次经济行为要有具体数字和代价。交易要有信息不对称的博弈感。资源的获取应服务于后续修炼/显圣/剧情，不要为赚钱而赚钱。",
  恋爱: "CP互动要有实质性推进——不是无信息量的'撒糖'。每次互动至少改变一点关系状态（信任+1、误解+1、默契+1）。通过身体反应和行动间接表达情感，避免直接陈述'她心动了'。",
  日常: "日常章不应纯灌水。要有：角色性格侧面展示、世界观细节渗透、或为后续剧情埋伏笔。用具体生活细节代替抽象'他们度过了愉快的一天'。",
  过渡: "过渡章的信息量可以降低但必须保持推进感。用场景切换/时间跳跃/对话摘要代替大段说明。章尾必须有钩子让读者期待下一阶段的展开。",
  说明: "世界观设定通过剧情自然释放，避免'科普段落'。方法：主角在行动中遇到规则→用对话/内心独白/他人反应来间接说明规则。每条新设定都要让读者有'原来如此'的满足感。",
  调查: "信息揭示要有层次——每步调查获得不完整信息→拼图式渐进。关键线索应通过具体物证/人证/环境细节呈现，而不是角色'突然想到'。红鲱鱼（误导线索）要合理不强行。",
  推理: "推理过程要让读者参与——在主角得出结论前，读者应能看到所有必要线索。结论应有逻辑链条，避免'直觉式'破案。留有余地让读者自行判断。",
};

export function getContentBeatGuide(beatType: string): string | null {
  return CONTENT_BEAT_GUIDES[beatType] ?? null;
}
