/**
 * Character Prohibitions — extract hard constraints for quality gate enforcement.
 *
 * Reads from Confirmation snapshot (characters scope) first, falls back to
 * live NovelCharacter records. Returns structured prohibitions for the
 * quality gate and context assembler.
 */

import { getPrisma } from "../../../platform/db/client";
import { getLatestSnapshot } from "../planning/ConfirmationService";

export interface CharacterProhibition {
  name: string;
  prohibitions: string[];
}

export async function buildCharacterProhibitions(
  novelId: string,
): Promise<CharacterProhibition[] | undefined> {
  const snapshot = await getLatestSnapshot(novelId, "characters");
  if (snapshot) {
    const charList = (snapshot.characters as Array<Record<string, unknown>>);
    const proh = charList
      .filter(c => { const p = c.prohibitions as string[]; return Array.isArray(p) && p.length > 0; })
      .map(c => ({ name: c.name as string, prohibitions: c.prohibitions as string[] }));
    return proh.length > 0 ? proh : undefined;
  }
  // Fallback to live characters
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
