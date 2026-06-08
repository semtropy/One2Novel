/**
 * Info Profile Service — track who knows what (dramatic irony).
 */
import { getPrisma } from "../../../../platform/db/client";

export async function listInfoProfiles(novelId: string, knowerId?: string) {
  const where: Record<string, unknown> = { novelId };
  if (knowerId) where.knowerId = knowerId;
  return getPrisma().characterInfoProfile.findMany({ where, include: { knower: { select: { name: true } } } });
}

export async function createInfoProfile(data: { novelId: string; knowerId: string; subject: string; content: string; certainty?: string; revealedIn?: number }) {
  return getPrisma().characterInfoProfile.create({ data });
}

export async function updateInfoProfile(id: string, data: Partial<{ subject: string; content: string; certainty: string }>) {
  return getPrisma().characterInfoProfile.update({ where: { id }, data });
}

export async function deleteInfoProfile(id: string) {
  return getPrisma().characterInfoProfile.delete({ where: { id } });
}

export async function getDramaticIronyReport(novelId: string): Promise<string> {
  const prisma = getPrisma();
  const profiles = await prisma.characterInfoProfile.findMany({
    where: { novelId },
    include: { knower: { select: { name: true } } },
  });

  const readerKnows = new Set<string>();
  const charKnows = new Map<string, string[]>();

  for (const p of profiles) {
    if (p.revealedIn) readerKnows.add(p.subject);
    charKnows.set(p.knower.name, [...(charKnows.get(p.knower.name) ?? []), p.subject]);
  }

  // Find what reader knows that specific characters don't
  const lines: string[] = [];
  for (const [name, subjects] of charKnows) {
    const readerOnly = [...readerKnows].filter(s => !subjects.includes(s));
    if (readerOnly.length > 0) {
      lines.push(`${name} 不知道：${readerOnly.join("、")}`);
    }
  }
  return lines.length > 0 ? `## 戏剧性反讽\n${lines.join("\n")}` : "";
}
