import { z } from "zod";
import { getPrisma } from "../../platform/db/client";
import { aiInvoke } from "../../platform/llm/aiService";

const PayoffSchema = z.object({
  items: z.array(z.object({ title: z.string(), summary: z.string(), scopeType: z.string(), status: z.string() })),
});

export async function scanChapterForPayoffs(novelId: string, chapterId: string): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) return;

  try {
    const result = await aiInvoke({
      task: "extractor",
      systemPrompt: [
        "你是小说伏笔分析师。从章节内容中识别所有伏笔/铺垫。伏笔包括：埋下的线索、未解之谜、角色的隐藏动机、暗示未来事件的细节。",
        "对每个识别的伏笔，确定其作用域(scopeType)：book(整书级)、volume(卷级)、chapter(本章级)。",
        "如果章节中触及了某个已有伏笔但未完全揭示，标记为hinted；如果是全新的伏笔标记为setup。",
      ].join("\n"),
      userPrompt: `分析以下章节的伏笔：\n\n${chapter.content.slice(0, 6000)}`,
      schema: PayoffSchema, temperature: 0.3,
    });

    const existing = await prisma.payoffLedgerItem.findMany({
      where: { novelId, currentStatus: { in: ["setup","hinted","pending_payoff"] } },
    });
    for (const p of existing) {
      if (chapter.content.includes(p.title)) {
        await prisma.payoffLedgerItem.update({
          where: { id: p.id },
          data: { currentStatus: p.currentStatus === "pending_payoff" ? "paid_off" : "pending_payoff", payoffChapterId: chapterId, lastTouchedOrder: chapter.order },
        });
      }
    }

    for (const item of result.items) {
      const ledgerKey = `${novelId}-${item.title}`;
      // H4: upsert instead of create to handle re-scans
      await prisma.payoffLedgerItem.upsert({
        where: { novelId_ledgerKey: { novelId, ledgerKey } },
        create: { novelId, ledgerKey, title: item.title, summary: item.summary, scopeType: item.scopeType, currentStatus: item.status, firstSeenOrder: chapter.order, lastTouchedOrder: chapter.order, setupChapterId: chapterId },
        update: { lastTouchedOrder: chapter.order, currentStatus: item.status },
      });
    }
  } catch {}
}

export async function getPayoffs(novelId: string) {
  return getPrisma().payoffLedgerItem.findMany({ where: { novelId }, orderBy: [{ firstSeenOrder: "asc" }, { currentStatus: "asc" }] });
}

// ─── Phase 15: Payoff deepening ────────────────────

/** Detect payoffs that are past their target chapter range */
export async function detectOverduePayoffs(novelId: string): Promise<void> {
  const prisma = getPrisma();
  // Get current max completed chapter order
  const chapters = await prisma.chapter.findMany({
    where: { novelId, chapterStatus: "completed" },
    orderBy: { order: "desc" },
    take: 1,
  });
  const maxOrder = chapters[0]?.order ?? 0;
  if (maxOrder === 0) return;

  // Find payoffs that should have been resolved by now
  const overdue = await prisma.payoffLedgerItem.findMany({
    where: {
      novelId,
      currentStatus: { notIn: ["paid_off", "failed"] },
      targetEndOrder: { not: null, lte: maxOrder },
    },
  });

  for (const item of overdue) {
    const gap = maxOrder - (item.targetEndOrder ?? maxOrder);
    if (gap >= 10) {
      await prisma.payoffLedgerItem.update({
        where: { id: item.id },
        data: { currentStatus: "failed", statusReason: `逾期${gap}章未兑现，自动标记为失败` },
      });
    } else if (gap >= 3) {
      await prisma.payoffLedgerItem.update({
        where: { id: item.id },
        data: { currentStatus: "overdue", statusReason: `已逾期${gap}章` },
      });
    }
  }
}

/** Manual payoff creation */
export async function createPayoff(
  novelId: string,
  data: { title: string; summary?: string; scopeType?: string; targetStartOrder?: number; targetEndOrder?: number },
): Promise<unknown> {
  const prisma = getPrisma();
  const ledgerKey = `${novelId}-${data.title}`;
  const maxOrder = (await prisma.chapter.findFirst({ where: { novelId }, orderBy: { order: "desc" }, select: { order: true } }))?.order ?? 0;

  return prisma.payoffLedgerItem.create({
    data: {
      novelId,
      ledgerKey,
      title: data.title,
      summary: data.summary ?? "",
      scopeType: data.scopeType ?? "book",
      currentStatus: "setup",
      targetStartOrder: data.targetStartOrder ?? maxOrder + 1,
      targetEndOrder: data.targetEndOrder ?? maxOrder + 5,
      firstSeenOrder: maxOrder,
      lastTouchedOrder: maxOrder,
    },
  });
}

/** Update a payoff item */
export async function updatePayoff(
  id: string,
  data: { title?: string; summary?: string; scopeType?: string; currentStatus?: string; targetStartOrder?: number; targetEndOrder?: number },
): Promise<unknown> {
  return getPrisma().payoffLedgerItem.update({ where: { id }, data });
}

/** Delete a payoff item */
export async function deletePayoff(id: string): Promise<void> {
  await getPrisma().payoffLedgerItem.delete({ where: { id } });
}

/** Enhanced payoff context with overdue warnings and richer instructions */
export async function getActivePayoffContext(novelId: string, chapterOrder: number): Promise<string> {
  const prisma = getPrisma();
  const payoffs = await prisma.payoffLedgerItem.findMany({
    where: { novelId, currentStatus: { in: ["setup", "hinted", "pending_payoff", "overdue"] } },
    take: 10,
    orderBy: { firstSeenOrder: "asc" },
  });

  if (payoffs.length === 0) return "";

  const lines = ["## 伏笔指令"];
  for (const p of payoffs) {
    const overdue = p.currentStatus === "overdue";
    const prefix = overdue ? "⚠ overdue" : p.currentStatus;
    const chapInfo = p.setupChapterId
      ? `第${p.firstSeenOrder}章埋下`
      : `首次出现于第${p.firstSeenOrder}章`;
    const targetInfo = p.targetEndOrder
      ? overdue
        ? ` · 应于第${p.targetEndOrder}章兑现 · ${p.statusReason ?? ""}`
        : ` · 应在第${p.targetStartOrder ?? "?"}-${p.targetEndOrder}章间兑现`
      : "";

    const action = p.currentStatus === "pending_payoff"
      ? "【必须在本章兑现或显著推进】"
      : p.currentStatus === "overdue"
        ? "【请尽快推进或手动标记为作废】"
        : p.currentStatus === "hinted"
          ? "【可轻触或施压】"
          : "【仅可铺垫/轻触】";

    lines.push(`- [${prefix} · ${chapInfo}${targetInfo}] ${p.title}\n  ${action}`);
  }

  return lines.join("\n");
}
