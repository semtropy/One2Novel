import { aiInvoke } from "../../platform/llm/aiService";
import { z } from "zod";
import { getPrisma } from "../../platform/db/client";
import { generateBookFraming } from "../novel/setup/bookFraming";
import { generateOutline } from "../novel/planning/storyMacro/outlineService";
import { generateCharacters } from "../novel/planning/characterPrep/characterService";

const IntentSchema = z.object({
  intent: z.string(),
  novelId: z.string().optional(),
  chapterNumber: z.number().optional(),
  response: z.string(),
  actions: z.array(z.object({
    type: z.string(),
    label: z.string(),
    args: z.record(z.string(), z.string()).optional(),
  })).optional(),
});

export async function processChatMessage(
  message: string,
  novelId?: string,
): Promise<{ response: string; actions: Array<{ type: string; label: string; args?: Record<string, string> }> }> {
  const prisma = getPrisma();

  // Gather context
  let context = "";
  if (novelId) {
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      include: {
        chapters: { orderBy: { order: "asc" }, take: 50 },
        characters: { take: 10 },
      },
    });
    if (novel) {
      const completed = novel.chapters.filter(c => c.chapterStatus === "completed").length;
      context = [
        `当前小说：《${novel.title}》（${novel.genre ?? "未分类"}）`,
        `状态：${completed}/${novel.chapters.length} 章已完成`,
        novel.targetAudience ? `读者：${novel.targetAudience}` : null,
        novel.structuredOutline ? "已有大纲" : "无大纲",
        novel.chapters.length > 0 ? `章节数：${novel.chapters.length}` : null,
      ].filter(Boolean).join("\n");
    }
  } else {
    const novels = await prisma.novel.findMany({ orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, title: true, genre: true } });
    if (novels.length > 0) {
      context = `现有小说：\n${novels.map(n => `- ${n.title}（${n.genre ?? ""}）[${n.id}]`).join("\n")}`;
    } else {
      context = "用户还没有创建任何小说。";
    }
  }

  const result = await aiInvoke({
    task: "planner",
    systemPrompt: `你是小说创作助手。理解用户的自然语言意图，以友好口语化的方式回复。

你可以帮用户做：
- create_novel: 创建新小说（需要书名、题材、灵感描述）
- generate_framing: 为当前小说生成书级定位
- generate_outline: 生成故事大纲
- generate_characters: 提取角色
- write_chapter: 写章节
- review: 审查章节
- chat: 闲聊或解答创作问题
- status: 查看当前状态

回复JSON: { intent, novelId?, chapterNumber?, response, actions?: [{ type, label, args? }] }
response要像朋友聊天一样自然，用中文。actions是可选的快捷操作按钮。只输出JSON。`,
    userPrompt: `上下文：\n${context}\n\n用户说：${message}`,
    schema: IntentSchema,
    temperature: 0.7,
  });

  return {
    response: result.response,
    actions: (result.actions ?? []) as Array<{ type: string; label: string; args?: Record<string, string> }>,
  };
}

interface ChatActionResult {
  message: string;
  data?: unknown;
}

export async function executeAction(
  action: { type: string; args?: Record<string, string> },
  novelId?: string,
): Promise<ChatActionResult> {
  const prisma = getPrisma();
  const nid = action.args?.novelId ?? novelId;

  try {
    switch (action.type) {
      case "create_novel": {
        if (!action.args?.title) return { message: "需要书名才能创建小说" };
        const novel = await prisma.novel.create({
          data: { title: action.args.title, genre: action.args.genre ?? "", description: action.args.description ?? "" },
        });
        return { message: `已创建小说《${novel.title}》`, data: { novelId: novel.id } };
      }
      case "generate_framing": {
        if (!nid) return { message: "请先选择一本小说" };
        const novel = await prisma.novel.findUnique({ where: { id: nid } });
        if (!novel) return { message: "小说不存在" };
        const framing = await generateBookFraming({
          title: novel.title, description: novel.description ?? undefined, genre: novel.genre ?? undefined,
        });
        await prisma.novel.update({ where: { id: nid }, data: {
          targetAudience: framing.targetAudience,
          commercialTags: JSON.stringify(framing.commercialTags),
          competingFeel: framing.competingFeel,
          bookSellingPoint: framing.bookSellingPoint,
          first30ChapterPromise: framing.first30ChapterPromise,
        }});
        return { message: `已为《${novel.title}》生成书级定位` };
      }
      case "generate_outline": {
        if (!nid) return { message: "请先选择一本小说" };
        const { outline, validation } = await generateOutline(nid);
        return { message: `已生成大纲：${outline.volumes.length}卷，共${outline.volumes.reduce((s, v) => s + v.chapters.length, 0)}章。${validation.summary}` };
      }
      case "generate_characters": {
        if (!nid) return { message: "请先选择一本小说" };
        const chars = await generateCharacters(nid);
        return { message: `已提取 ${chars.characters.length} 个角色：${chars.characters.map(c => c.name).join("、")}` };
      }
      case "status": {
        if (!nid) return { message: "请先选择一本小说" };
        const n = await prisma.novel.findUnique({ where: { id: nid }, include: { chapters: { orderBy: { order: "asc" } } } });
        if (!n) return { message: "小说不存在" };
        const done = n.chapters.filter(c => c.chapterStatus === "completed").length;
        return { message: `《${n.title}》：${n.chapters.length}章，${done}章已完成，${n.chapters.filter(c => c.chapterStatus === "drafted").length}章草稿` };
      }
      default:
        return { message: "这个操作暂不支持" };
    }
  } catch (e) {
    return { message: `操作失败：${e instanceof Error ? e.message : "未知错误"}` };
  }
}
