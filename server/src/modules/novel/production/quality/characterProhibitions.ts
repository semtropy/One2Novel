/**
 * Character Prohibitions — extract hard constraints for quality gate enforcement.
 * Reads directly from NovelCharacter records (no more Confirmation snapshot).
 */

import { getPrisma } from "../../../../platform/db/client";

export interface CharacterProhibition {
  name: string;
  prohibitions: string[];
}

/** Split a natural-language prohibitions string into individual items. */
function splitProhibitions(text: string): string[] {
  return text
    .split(/[、，;\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function buildCharacterProhibitions(
  novelId: string,
): Promise<CharacterProhibition[]> {
  const prisma = getPrisma();
  const chars = await prisma.novelCharacter.findMany({
    where: { novelId, prohibitions: { not: null } },
    select: { name: true, prohibitions: true },
  });
  return chars
    .map(c => {
      const items = splitProhibitions(c.prohibitions!);
      return items.length > 0 ? { name: c.name, prohibitions: items } : undefined;
    })
    .filter((c): c is CharacterProhibition => c !== undefined);
}
