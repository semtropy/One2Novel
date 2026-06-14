/**
 * Resource Ledger Service — track character items/abilities/allies.
 * ADAPTED from OP CharacterResourceLedgerService.ts (265 lines).
 */
import { getPrisma } from "../../../../platform/db/client";

export interface ResourceData {
  novelId: string; ownerId: string; name: string; category: string;
  description?: string; acquiredInChapterId?: string; constraints?: string;
}

export async function listResources(novelId: string, ownerId?: string, category?: string) {
  const prisma = getPrisma();
  const where: Record<string, unknown> = { novelId };
  if (ownerId) where.ownerId = ownerId;
  if (category) where.category = category;
  return prisma.characterResource.findMany({ where, orderBy: { category: "asc" } });
}

export async function createResource(data: ResourceData) {
  return getPrisma().characterResource.create({ data: { ...data, status: "active" } });
}

export async function updateResource(id: string, data: Partial<ResourceData & { status: string; depletedInChapterId: string }>) {
  return getPrisma().characterResource.update({ where: { id }, data });
}

export async function deleteResource(id: string) {
  return getPrisma().characterResource.delete({ where: { id } });
}

export function getResourceSummary(novelId: string): Promise<string> {
  return getPrisma().characterResource.findMany({
    where: { novelId, status: "active" },
    include: { owner: { select: { name: true } } },
  }).then(items => {
    if (items.length === 0) return "";
    const grouped = new Map<string, typeof items>();
    for (const i of items) {
      const key = i.owner.name;
      grouped.set(key, [...(grouped.get(key) ?? []), i]);
    }
    return Array.from(grouped.entries())
      .map(([name, res]) => `- ${name}：${res.map(r => `${r.name}(${r.category})`).join("、")}`)
      .join("\n");
  });
}

export async function checkResourceConsistency(novelId: string): Promise<string[]> {
  const prisma = getPrisma();
  const items = await prisma.characterResource.findMany({
    where: { novelId },
    include: { acquiredInChapter: { select: { order: true } }, depletedInChapter: { select: { order: true } } },
  });
  const warnings: string[] = [];

  for (const item of items) {
    const acquiredOrder = item.acquiredInChapter?.order;
    const depletedOrder = item.depletedInChapter?.order;
    if (acquiredOrder != null && depletedOrder != null && depletedOrder < acquiredOrder) {
      warnings.push(`${item.name}: 消耗于第${depletedOrder}章，但获取于第${acquiredOrder}章（顺序错误）`);
    }
    // Resource acquired but never used after 10+ chapters
    if (acquiredOrder != null && item.status === "active") {
      const chapters = await prisma.chapter.count({ where: { novelId } });
      if (chapters > acquiredOrder + 10) {
        warnings.push(`${item.name}: 第${acquiredOrder}章获取后超过10章未使用，可能被遗忘`);
      }
    }
  }
  return warnings;
}
