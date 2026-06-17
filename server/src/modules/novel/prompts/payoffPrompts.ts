/**
 * Payoff prompts — foreshadowing scanning.
 */
import { promptRegistry } from "../../../platform/llm/aiService";

// ── Payoff: Scan ─────────────────────────────────────────

promptRegistry.register({
  id: "novel.payoff.scan",
  taskType: "extractor", version: "v1",
  systemPrompt: [
    "你是小说伏笔分析师。从章节内容中识别所有伏笔/铺垫。伏笔包括：埋下的线索、未解之谜、角色的隐藏动机、暗示未来事件的细节。",
    "对每个识别的伏笔，确定其作用域(scopeType)：book(整书级)、volume(卷级)、chapter(本章级)。",
    "如果章节中触及了某个已有伏笔但未完全揭示，标记为hinted；如果是全新的伏笔标记为setup。",
    "",
    "关键：你必须检查本章是否触及或兑现了「已有伏笔清单」中的任何伏笔。",
    "- 如果某个已有伏笔被本章触及（提及/暗示/部分揭示），将其ID填入 touchedPayoffIds。",
    "- 如果某个已有伏笔被本章完全兑现（谜底揭晓/线索回收），将其ID填入 paidOffPayoffIds。",
    "- 语义匹配：不要求原文出现完全相同的标题文字，只要剧情实质触及该伏笔即可。",
  ].join("\n"),
});
