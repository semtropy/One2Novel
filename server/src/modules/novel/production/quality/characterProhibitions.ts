/**
 * Character Prohibitions — extract hard constraints for quality gate enforcement.
 * Reads directly from NovelCharacter records (no more Confirmation snapshot).
 */

import { getPrisma } from "../../../../platform/db/client";

export interface CharacterProhibition {
  name: string;
  prohibitions: string[];
}

export async function buildCharacterProhibitions(
  novelId: string,
): Promise<CharacterProhibition[] | undefined> {
  const prisma = getPrisma();
  const chars = await prisma.novelCharacter.findMany({
    where: { novelId, prohibitions: { not: null } },
    select: { name: true, prohibitions: true },
  });
  const proh = chars
    .filter(c => {
      try { const p = JSON.parse(c.prohibitions ?? "[]"); return Array.isArray(p) && p.length > 0; } catch { return false; }
    })
    .map(c => ({ name: c.name, prohibitions: JSON.parse(c.prohibitions ?? "[]") as string[] }));
  return proh.length > 0 ? proh : undefined;
}
