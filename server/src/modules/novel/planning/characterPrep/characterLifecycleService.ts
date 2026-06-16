/**
 * Character Lifecycle Service — manages character presence across volumes for long-form novels.
 * Tracks which characters are active/inactive/returning/departing per volume,
 * detects long-absent characters, and recommends volume-level casting.
 */
import { getPrisma } from "../../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export type PresenceState = "active" | "inactive" | "returning" | "departing";

export interface CharacterPresenceRecord {
  characterId: string;
  characterName: string;
  role: string;
  volumeOrder: number;
  presence: PresenceState;
  trajectoryNote: string | null;
}

export interface VolumeCastRecommendation {
  volumeOrder: number;
  activeCharacters: Array<{ characterId: string; characterName: string; role: string; reason: string }>;
  returningCharacters: Array<{ characterId: string; characterName: string; role: string; returnReason: string }>;
  departingCharacters: Array<{ characterId: string; characterName: string; role: string; departReason: string }>;
  restingCharacters: Array<{ characterId: string; characterName: string; role: string }>;
}

// ─── Public API ─────────────────────────────────────────

/** Get all character presence records for a novel's volumes */
export async function getCharacterPresence(novelId: string, volumeOrder?: number): Promise<CharacterPresenceRecord[]> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = { novelId };
  if (volumeOrder !== undefined) where.volumeOrder = volumeOrder;
  const records = await prisma.characterVolumePresence.findMany({
    where,
    include: { character: { select: { name: true, role: true } } },
    orderBy: [{ volumeOrder: "asc" }, { character: { name: "asc" } }],
  });
  return records.map(r => ({
    characterId: r.characterId,
    characterName: r.character.name,
    role: r.character.role,
    volumeOrder: r.volumeOrder,
    presence: r.presence as PresenceState,
    trajectoryNote: r.trajectoryNote,
  }));
}

/** Set presence for a character in a specific volume */
export async function setCharacterPresence(
  novelId: string,
  characterId: string,
  volumeOrder: number,
  presence: PresenceState,
  trajectoryNote?: string,
): Promise<void> {
  const prisma = getPrisma();
  await prisma.characterVolumePresence.upsert({
    where: { novelId_characterId_volumeOrder: { novelId, characterId, volumeOrder } },
    create: { novelId, characterId, volumeOrder, presence, trajectoryNote },
    update: { presence, trajectoryNote },
  });
}

/** Auto-initialize presence for all characters for a new volume based on previous volume state */
export async function initializeVolumePresence(novelId: string, volumeOrder: number): Promise<void> {
  const prisma = getPrisma();
  const characters = await prisma.novelCharacter.findMany({ where: { novelId }, select: { id: true, name: true } });
  if (characters.length === 0) return;

  // Look at previous volume's presence as baseline
  const prevPresence = await prisma.characterVolumePresence.findMany({
    where: { novelId, volumeOrder: volumeOrder - 1 },
  });

  for (const char of characters) {
    const prev = prevPresence.find(p => p.characterId === char.id);
    // Active characters stay active by default; inactive stay inactive; returning ones become active
    const presence: string = prev?.presence === "returning" ? "active"
      : prev?.presence === "departing" ? "inactive"
      : (prev?.presence ?? "active");

    await prisma.characterVolumePresence.upsert({
      where: { novelId_characterId_volumeOrder: { novelId, characterId: char.id, volumeOrder } },
      create: { novelId, characterId: char.id, volumeOrder, presence },
      update: {}, // Don't overwrite if already set
    });
  }
}

/** Detect characters absent for too many chapters */
export async function detectLongAbsentCharacters(
  novelId: string,
  currentChapterOrder: number,
  absenceThreshold = 10,
): Promise<Array<{ characterId: string; characterName: string; chaptersSinceLastAppearance: number }>> {
  const prisma = getPrisma();
  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { id: true, name: true },
  });

  const results: Array<{ characterId: string; characterName: string; chaptersSinceLastAppearance: number }> = [];

  for (const char of characters) {
    // Find the most recent chapter where this character appeared by checking timeline
    const lastTimeline = await prisma.timelineItem.findFirst({
      where: {
        novelId,
        title: { contains: char.name },
        sortOrder: { lt: currentChapterOrder },
      },
      orderBy: { sortOrder: "desc" },
    });
    if (lastTimeline) {
      const chaptersSince = currentChapterOrder - lastTimeline.sortOrder;
      if (chaptersSince >= absenceThreshold) {
        results.push({
          characterId: char.id,
          characterName: char.name,
          chaptersSinceLastAppearance: chaptersSince,
        });
      }
    }
  }

  return results;
}

/** Generate a volume cast recommendation based on loop structure and character lifecycle */
export async function recommendVolumeCast(
  novelId: string,
  volumeOrder: number,
): Promise<VolumeCastRecommendation> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { id: true, name: true, role: true },
  });

  const prevPresence = await getCharacterPresence(novelId, volumeOrder - 1);

  // Simple heuristic-based recommendation:
  // - Protagonist is always active
  // - Antagonists are active every other volume (to build tension)
  // - Supporting characters rotate — some rest, some return
  const activeCharacters: VolumeCastRecommendation["activeCharacters"] = [];
  const returningCharacters: VolumeCastRecommendation["returningCharacters"] = [];
  const departingCharacters: VolumeCastRecommendation["departingCharacters"] = [];
  const restingCharacters: VolumeCastRecommendation["restingCharacters"] = [];

  for (const char of characters) {
    const prev = prevPresence.find(p => p.characterId === char.id);

    if (char.role === "protagonist") {
      activeCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, reason: "主角始终在场" });
    } else if (char.role === "antagonist") {
      if (volumeOrder % 2 === 0 || !prev || prev.presence === "inactive") {
        returningCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, returnReason: "对手回归制造新威胁" });
      } else {
        activeCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, reason: "对手持续施压" });
      }
    } else if (char.role === "supporting") {
      // Rotate supporting cast: after 5+ consecutive active volumes (~90 chapters), suggest rest
      const consecutiveActive = prev?.presence === "active" ? ((prev as any).consecutiveActive ?? 1) + 1 : 0;
      if (!prev || prev.presence === "inactive" || prev.presence === "departing") {
        returningCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, returnReason: "配角回归补充阵容" });
      } else if (consecutiveActive >= 5) {
        departingCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, departReason: `已连续活跃${consecutiveActive}卷(~${consecutiveActive * 18}章)，本卷暂离为下卷回归做铺垫` });
        restingCharacters.push({ characterId: char.id, characterName: char.name, role: char.role });
      } else {
        activeCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, reason: "配角在场丰富故事层次" });
      }
    } else {
      // Minor characters: mostly resting, occasionally return
      if (prev?.presence === "returning") {
        activeCharacters.push({ characterId: char.id, characterName: char.name, role: char.role, reason: "次要角色短暂出场" });
      } else {
        restingCharacters.push({ characterId: char.id, characterName: char.name, role: char.role });
      }
    }
  }

  return { volumeOrder, activeCharacters, returningCharacters, departingCharacters, restingCharacters };
}
