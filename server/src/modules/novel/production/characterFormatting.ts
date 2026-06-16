/**
 * Character formatting helpers — shared between context assembly (live-read fallback)
 * and block builders (snapshot formatting).
 */

export interface CharacterFormatFields {
  name: string; role: string; personality?: string | null;
  appearance?: string | null; quirks?: string | null;
  currentStatus?: string | null; currentGoal?: string | null;
  voiceTexture?: string | null; identityLabel?: string | null;
  prohibitions?: string | null;
}

function formatCharacterRecord(c: CharacterFormatFields): string {
  const parts = [`${c.name}（${c.role}）`];
  if (c.personality) parts.push(`性格：${c.personality}`);
  if (c.currentGoal) parts.push(`目标：${c.currentGoal}`);
  if (c.appearance) parts.push(`外貌：${c.appearance}`);
  if (c.quirks) parts.push(`习惯：${c.quirks}`);
  if (c.currentStatus) parts.push(`状态：${c.currentStatus}`);
  if (c.voiceTexture) parts.push(`语感：${c.voiceTexture}`);
  if (c.identityLabel) parts.push(`身份：${c.identityLabel}`);
  if (c.prohibitions) parts.push(`底线：${c.prohibitions}`);
  return parts.join(" · ");
}

export function formatCharactersFromSnapshot(characterSnapshot: Record<string, unknown>): string {
  const charList = (characterSnapshot.characters as Array<Record<string, unknown>>) ?? [];
  return charList.map(c => formatCharacterRecord(c as unknown as CharacterFormatFields)).join("\n");
}

export function buildLiveFraming(novel: {
  targetAudience?: string | null; bookSellingPoint?: string | null;
  competingFeel?: string | null; first30ChapterPromise?: string | null;
}): string {
  return [
    novel.targetAudience ? `目标读者：${novel.targetAudience}` : null,
    novel.bookSellingPoint ? `核心卖点：${novel.bookSellingPoint}` : null,
    novel.competingFeel ? `差异化：${novel.competingFeel}` : null,
    novel.first30ChapterPromise ? `前30章承诺：${novel.first30ChapterPromise}` : null,
  ].filter(Boolean).join("\n");
}

export function buildLiveCharacters(novel: {
  characters: Array<{
    name: string; role: string; personality?: string | null;
    appearance?: string | null; quirks?: string | null;
    currentStatus?: string | null; currentGoal?: string | null;
    voiceTexture?: string | null; identityLabel?: string | null;
    prohibitions?: string | null;
  }>;
}): string {
  const active = novel.characters.filter(c => c.currentStatus || c.currentGoal || c.personality);
  const roster = novel.characters.filter(c => !c.currentStatus && !c.currentGoal && !c.personality);

  const parts: string[] = [];
  // Full roster (compact: name + role only)
  if (novel.characters.length > 0) {
    parts.push(`[角色名录 ${novel.characters.length}人] ${novel.characters.map(c => `${c.name}(${c.role})`).join("、")}`);
  }
  // Detailed info for active characters only
  if (active.length > 0) {
    parts.push(`\n[活跃角色详情]`);
    parts.push(active.map(c => formatCharacterRecord(c)).join("\n"));
  }
  // Brief info for inactive characters
  if (roster.length > 0 && roster.length <= 30) {
    parts.push(roster.map(c => formatCharacterRecord(c)).join("\n"));
  }
  return parts.join("\n");
}
