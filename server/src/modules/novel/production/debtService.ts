/**
 * Chase Debt Service — 追读力债务系统
 *
 * 核心问题：质量门控只有硬约束（角色禁忌），没有软约束追踪。
 * 作者可以随意忽略"每 3 章需要一个爽点"的节奏建议，系统不会记这笔账。
 *
 * 解决方案：
 * 1. 质量门控发现软约束违背 → 创建 OverrideContract
 * 2. 每章完成后 → 计算所有 active debt 的利息（默认 10%/章）
 * 3. StatisticsDashboard 展示债务趋势
 * 4. 下一卷规划时，系统自动提示"你有 N 的债务需要偿还"
 */
import { getPrisma } from "../../../platform/db/client";
import type { PrismaClient } from "@prisma/client";
import { logEventError } from "../../../platform/logging/eventErrorLog";

// ─── Types ───────────────────────────────────────────────

export interface DebtSummary {
  totalDebt: number;
  activeDebts: number;
  overdueDebts: number;
  totalOverrides: number;
  pendingOverdue: number;
  trend: "increasing" | "stable" | "decreasing";
}

export interface OverrideContract {
  id: string;
  chapter: number;
  constraintType: string;
  constraintId: string;
  rationaleType: string;
  rationaleText: string | null;
  paybackPlan: string | null;
  dueChapter: number;
  status: string;
}

// ─── Functions ───────────────────────────────────────────

/**
 * 创建 Override Contract。
 * 当质量门控发现软约束违背但作者有正当理由时调用。
 */
export async function createOverrideContract(
  prisma: PrismaClient,
  novelId: string,
  chapter: number,
  constraintType: string,
  constraintId: string,
  rationaleType: string,
  rationaleText: string,
  paybackPlan: string,
  dueChapter: number,
): Promise<string> {
  const contract = await prisma.overrideContract.create({
    data: {
      novelId,
      chapter,
      constraintType,
      constraintId,
      rationaleType,
      rationaleText,
      paybackPlan,
      dueChapter,
      status: "pending",
    },
  });
  return contract.id;
}

/**
 * 计算所有 active debt 的利息。
 * 每章完成后调用一次。
 */
export async function accrueInterest(novelId: string, currentChapter: number): Promise<{ accrued: number; totalDebt: number }> {
  try {
    const prisma = getPrisma();
    // 获取所有 active 债务
    const activeDebts = await prisma.chaseDebt.findMany({
      where: {
        novelId,
        status: "active",
      },
    });

    let accrued = 0;
    for (const debt of activeDebts) {
      const daysSinceCreation = Math.max(1, currentChapter - debt.sourceChapter);
      const interest = debt.originalAmount * Math.pow(debt.interestRate, daysSinceCreation);
      const newAmount = debt.currentAmount + (interest - debt.originalAmount);

      if (newAmount > debt.currentAmount) {
        await prisma.chaseDebt.update({
          where: { id: debt.id },
          data: { currentAmount: newAmount, updatedAt: new Date() },
        });
        accrued++;

        // 记录利息事件
        await prisma.debtEvent.create({
          data: {
            novelId: debt.novelId,
            debtId: debt.id,
            eventType: "interest_accrued",
            amount: newAmount - debt.currentAmount,
            chapter: currentChapter,
            note: `利息累积：${debt.debtType}`,
          },
        });
      }
    }

    const total = await prisma.chaseDebt.aggregate({
      _sum: { currentAmount: true },
      where: { novelId, status: "active" },
    });

    return { accrued, totalDebt: total._sum.currentAmount ?? 0 };
  } catch (e) {
    logEventError("debt.accrue_interest", { chapter: currentChapter }, e);
    return { accrued: 0, totalDebt: 0 };
  }
}

/**
 * 偿还债务。
 * 当作者在后续章节中兑现了软约束时调用。
 */
export async function payDebt(
  debtId: string,
  amount: number,
  chapter: number,
  novelId: string,
): Promise<boolean> {
  try {
    const prisma = getPrisma();
    const debt = await prisma.chaseDebt.findUnique({
      where: { id: debtId },
    });
    if (!debt) return false;

    const newAmount = Math.max(0, debt.currentAmount - amount);

    await prisma.chaseDebt.update({
      where: { id: debtId },
      data: {
        currentAmount: newAmount,
        status: newAmount === 0 ? "paid" : debt.status,
        updatedAt: new Date(),
      },
    });

    // 记录偿还事件
    await prisma.debtEvent.create({
      data: {
        novelId,
        debtId,
        eventType: amount >= debt.currentAmount ? "full_payment" : "partial_payment",
        amount,
        chapter,
        note: `偿还 ${amount.toFixed(2)} 的 ${debt.debtType} 债务`,
      },
    });

    return true;
  } catch (e) {
    logEventError("debt.pay", { debtId, chapter }, e);
    return false;
  }
}

/**
 * 获取债务摘要。
 */
export async function getDebtSummary(novelId: string, currentChapter?: number): Promise<DebtSummary> {
  try {
    const prisma = getPrisma();
    const [activeDebts, overdueDebts, allContracts] = await Promise.all([
      prisma.chaseDebt.findMany({
        where: { novelId, status: "active" },
        select: { currentAmount: true },
      }),
      prisma.chaseDebt.findMany({
        where: currentChapter != null
          ? { novelId, status: "active", dueChapter: { lt: currentChapter } }
          : { novelId, status: "active" },
      }),
      prisma.overrideContract.findMany({
        where: { novelId },
        select: { status: true, dueChapter: true },
      }),
    ]);

    const totalDebt = activeDebts.reduce((sum: number, d: { currentAmount: number }) => sum + d.currentAmount, 0);
    const totalOverrides = allContracts.length;
    const pendingOverdue = allContracts.filter(
      (c: { status: string; dueChapter: number }) => c.status === "pending" && currentChapter != null && c.dueChapter < currentChapter,
    ).length;

    // 趋势判断（简化版）
    const trend: DebtSummary["trend"] = totalDebt > 5 ? "increasing" : totalDebt < 1 ? "decreasing" : "stable";

    return {
      totalDebt: Math.round(totalDebt * 100) / 100,
      activeDebts: activeDebts.length,
      overdueDebts: overdueDebts.length,
      totalOverrides,
      pendingOverdue,
      trend,
    };
  } catch (e) {
    logEventError("debt.getSummary", { novelId }, e);
    return {
      totalDebt: 0, activeDebts: 0, overdueDebts: 0,
      totalOverrides: 0, pendingOverdue: 0, trend: "stable",
    };
  }
}
