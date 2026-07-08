/**
 * Entity Lifecycle Tracker — 实体状态历史追踪
 *
 * 核心问题：NovelCharacter.currentStatus 是扁平字符串。
 * 如果 LLM 在第 150 章漏掉了"角色死亡"的更新，第 500 章还会认为角色"活着"。
 *
 * 解决方案：
 * 1. 每次 characterStateUpdater 写入后，记录到 EntityStateJournal（审计轨迹）
 * 2. 检测重大状态变化（死亡/重生/关系破裂），写入 EntityLifecycle
 * 3. 上下文块新增 entity_lifecycle（priority 95），展示角色生命周期状态
 * 4. qualityGate 检查"当前章节是否出现了已死亡角色"
 */
import { z } from "zod";
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { logEventError } from "../../../../platform/logging/eventErrorLog";

// ─── Types ───────────────────────────────────────────────

export interface EntityLifecycleEntry {
  characterName: string;
  roleId: string;
  status: "alive" | "dead" | "absent" | "dormant" | "appearing";
  currentStatus: string | null;
  currentLocation: string | null;
  currentGoal: string | null;
  lastChangedChapter: number | null;
  reason: string | null;
}

// ─── LLM Schema ─────────────────────────────────────────

const LifecycleUpdateSchema = z.object({
  changes: z.array(z.object({
    characterName: z.string(),
    oldStatus: z.string().nullable(),
    newStatus: z.string().nullable(),
    isMajor: z.boolean().default(false), // 是否重大变化（死亡/重生）
    majorType: z.enum(["death", "revival", "relationship_break", "power_ceiling"]).nullable(),
    reason: z.string().nullable(),
    confidence: z.number().min(0).max(1).default(1.0),
  })),
});

// ─── Public API ──────────────────────────────────────────

/**
 * 更新实体生命周期状态。
 * 在 characterStateUpdater 之后调用，检测重大状态变化。
 */
export async function updateEntityLifecycle(
  novelId: string,
  chapterOrder: number,
  characterUpdates: Array<{
    characterId: string;
    characterName: string;
    oldStatus: string | null;
    newStatus: string | null;
    currentLocation: string | null;
    currentGoal: string | null;
  }>,
): Promise<void> {
  const prisma = getPrisma();

  for (const update of characterUpdates) {
    // 1. 写入 EntityStateJournal（审计轨迹）
    if (update.oldStatus !== update.newStatus) {
      try {
        await prisma.entityStateJournal.create({
          data: {
            novelId,
            characterId: update.characterId,
            field: "currentStatus",
            oldValue: update.oldStatus ?? "(null)",
            newValue: update.newStatus ?? "(null)",
            changedAtChapter: chapterOrder,
            confidence: 0.9,
            reason: `状态从"${update.oldStatus}"变为"${update.newStatus}"`,
          },
        });
      } catch (e) {
        logEventError("entityLifecycle.journal", { novelId, chapterOrder }, e);
      }
    }

    // 2. 检测重大变化 → 更新 EntityLifecycle
    const wasAlive = isAlive(update.oldStatus);
    const isDead = isDeadStatus(update.newStatus);

    if (wasAlive && isDead) {
      // 角色死亡
      try {
        await prisma.entityLifecycle.upsert({
          where: { novelId_characterId: { novelId, characterId: update.characterId } },
          create: {
            novelId,
            characterId: update.characterId,
            status: "dead",
            statusChangedAtChapter: chapterOrder,
            reason: `角色死亡（从"${update.oldStatus}"变为"${update.newStatus}"）`,
            confidence: 0.9,
          },
          update: {
            status: "dead",
            statusChangedAtChapter: chapterOrder,
            reason: `角色死亡（从"${update.oldStatus}"变为"${update.newStatus}"）`,
          },
        });

        // 记录债务事件
        await prisma.debtEvent.create({
          data: {
            novelId,
            debtId: "n/a",
            eventType: "created",
            amount: 1.0,
            chapter: chapterOrder,
            note: `角色${update.characterName}死亡`,
          },
        });
      } catch (e) {
        logEventError("entityLifecycle.death", { novelId, chapterOrder }, e);
      }
    } else if (!wasAlive && !isDead && update.newStatus) {
      // 角色复活
      try {
        await prisma.entityLifecycle.upsert({
          where: { novelId_characterId: { novelId, characterId: update.characterId } },
          create: {
            novelId,
            characterId: update.characterId,
            status: "alive",
            statusChangedAtChapter: chapterOrder,
            reason: `角色复活`,
            confidence: 0.8,
          },
          update: {
            status: "alive",
            statusChangedAtChapter: chapterOrder,
            reason: `角色复活`,
          },
        });
      } catch (e) {
        logEventError("entityLifecycle.revival", { novelId, chapterOrder }, e);
      }
    }

    // 3. 常规更新（不死不活的状态变化）
    try {
      await prisma.entityLifecycle.upsert({
        where: { novelId_characterId: { novelId, characterId: update.characterId } },
        create: {
          novelId,
          characterId: update.characterId,
          status: "alive",
          statusChangedAtChapter: chapterOrder,
          reason: `初始状态: ${update.newStatus}`,
          confidence: 1.0,
        },
        update: {
          statusChangedAtChapter: chapterOrder,
          reason: `状态变更: ${update.oldStatus} → ${update.newStatus}`,
        },
      });
    } catch { /* best-effort */ }
  }
}

/**
 * 构建实体生命周期上下文块。
 * 在 assembleChapterBlocks 中调用，展示所有角色的生命周期状态。
 */
export async function buildEntityLifecycleBlock(novelId: string): Promise<EntityLifecycleEntry[]> {
  const prisma = getPrisma();

  const lifecycles = await prisma.entityLifecycle.findMany({
    where: { novelId },
    include: {
      character: { select: { name: true, currentStatus: true, currentLocation: true, currentGoal: true } },
    },
    orderBy: { statusChangedAtChapter: "desc" },
  });

  const entries: EntityLifecycleEntry[] = lifecycles.map(lc => ({
    characterName: lc.character.name,
    roleId: lc.characterId,
    status: lc.status as EntityLifecycleEntry["status"],
    currentStatus: lc.character.currentStatus,
    currentLocation: lc.character.currentLocation,
    currentGoal: lc.character.currentGoal,
    lastChangedChapter: lc.statusChangedAtChapter,
    reason: lc.reason,
  }));

  // 补充没有 lifecycle 记录的角色
  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { id: true, name: true, currentStatus: true, currentLocation: true, currentGoal: true },
  });

  const existingIds = new Set(entries.map(e => e.roleId));
  for (const char of characters) {
    if (!existingIds.has(char.id)) {
      entries.push({
        characterName: char.name,
        roleId: char.id,
        status: "alive",
        currentStatus: char.currentStatus,
        currentLocation: char.currentLocation,
        currentGoal: char.currentGoal,
        lastChangedChapter: null,
        reason: null,
      });
    }
  }

  return entries;
}

/**
 * 构建 entity_lifecycle 上下文块内容字符串。
 */
export function compileEntityLifecycleContent(entries: EntityLifecycleEntry[]): string {
  if (entries.length === 0) return "";

  const lines = ["【实体生命周期 — 以下角色状态为不可违背的历史事实。已死亡角色绝不可在本章出现。】"];

  // 分组：已死亡 / 活跃 / 缺席
  const dead = entries.filter(e => e.status === "dead");
  const alive = entries.filter(e => e.status !== "dead");

  if (alive.length > 0) {
    lines.push("");
    lines.push("== 活跃角色 ==");
    for (const e of alive) {
      const parts = [`${e.characterName}`];
      if (e.currentStatus) parts.push(`状态: ${e.currentStatus}`);
      if (e.currentLocation) parts.push(`位置: ${e.currentLocation}`);
      if (e.currentGoal) parts.push(`目标: ${e.currentGoal}`);
      if (e.lastChangedChapter) parts.push(`最后变更: 第${e.lastChangedChapter}章`);
      lines.push(parts.join(" | "));
    }
  }

  if (dead.length > 0) {
    lines.push("");
    lines.push("== 已死亡角色（绝对不可出现）==");
    for (const e of dead) {
      lines.push(`⚠️ ${e.characterName} — 死于第${e.lastChangedChapter ?? "?"}章：${e.reason ?? "原因不明"}`);
    }
  }

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────

/** 判断状态字符串是否表示"活着" */
function isAlive(status: string | null): boolean {
  if (!status) return true; // null = 默认活着
  const s = status.toLowerCase();
  return !s.includes("死") && !s.includes("亡") && !s.includes("death") && !s.includes("dead") && !s.includes("陨落") && !s.includes("消亡");
}

/** 判断状态字符串是否表示"死亡" */
function isDeadStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes("死") || s.includes("亡") || s.includes("death") || s.includes("dead") || s.includes("陨落") || s.includes("消亡") || s.includes("去世") || s.includes("牺牲");
}

/**
 * 检查章节内容是否出现了已死亡角色。
 * 用于 qualityGate 的硬约束检查。
 */
export function checkDeadCharactersInContent(
  content: string,
  deadCharacters: EntityLifecycleEntry[],
): Array<{ characterName: string; evidence: string }> {
  const violations: Array<{ characterName: string; evidence: string }> = [];

  for (const dc of deadCharacters) {
    // 检查角色名是否出现在内容中
    if (content.includes(dc.characterName)) {
      // 更精确的检查：排除"回忆""提到"等语境
      // 简单做法：如果角色名出现超过 1 次，大概率是实际出场而非提及
      const matches = content.match(new RegExp(dc.characterName, "g"));
      if (matches && matches.length > 1) {
        violations.push({
          characterName: dc.characterName,
          evidence: `已死亡角色"${dc.characterName}"在正文中出现 ${matches.length} 次（死于第${dc.lastChangedChapter ?? "?"}章）`,
        });
      }
    }
  }

  return violations;
}
