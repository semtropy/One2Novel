/**
 * Confirmation Service — Unified planning→writing linkage.
 *
 * Replaces the old lock/unlock model. "Confirm" is now a repeatable sync action:
 * draft tables → production tables, with a Confirmation record + snapshot each time.
 *
 * Three scopes:
 *   story_seed  — Novel fields → Confirmation snapshot (context uses latest snapshot)
 *   characters  — DraftCharacter + DraftCharacterRelation → NovelCharacter + NovelCharacterRelation
 *   blueprint   — DraftPlan → VolumeChapterPlan + Chapter (via syncDraftPlansToWriting)
 */

import { getPrisma } from "../../../platform/db/client";
import { parseTags } from "../../../platform/data/tagHelpers";
import { syncDraftPlansToWriting, syncDraftCharactersToWriting, syncDraftRelationsToWriting } from "../setup/volumeChapterSync";

// ─── Types ─────────────────────────────────────────────

export const ALL_SCOPES = ["story_seed", "characters", "blueprint"] as const;
export type Scope = typeof ALL_SCOPES[number];

export interface ScopeStatus {
  confirmed: boolean;
  dirty: boolean;
  dirtyCount: number;
  lastConfirmedAt: string | null;
}

export interface ConfirmationStatus {
  story_seed: ScopeStatus;
  characters: ScopeStatus;
  blueprint: ScopeStatus;
}

// ─── Public API ────────────────────────────────────────

/** Get confirmation status for all scopes. */
export async function getConfirmationStatus(novelId: string): Promise<ConfirmationStatus> {
  const prisma = getPrisma();

  const [confirmations, unsyncedPlans, unsyncedChars, unsyncedSeed] = await Promise.all([
    prisma.confirmation.findMany({ where: { novelId } }),
    prisma.draftPlan.count({ where: { volume: { novelId }, synced: false } }),
    prisma.draftCharacter.count({ where: { novelId, synced: false } }),
    prisma.draftStorySeed.count({ where: { novelId, synced: false } }),
  ]);

  const confirmedScopes = new Set(confirmations.map(c => c.scope));

  return {
    story_seed: {
      confirmed: confirmedScopes.has("story_seed"),
      dirty: unsyncedSeed > 0,
      dirtyCount: unsyncedSeed,
      lastConfirmedAt: confirmations.find(c => c.scope === "story_seed")?.createdAt?.toISOString() ?? null,
    },
    characters: {
      confirmed: confirmedScopes.has("characters"),
      dirty: unsyncedChars > 0,
      dirtyCount: unsyncedChars,
      lastConfirmedAt: confirmations.find(c => c.scope === "characters")?.createdAt?.toISOString() ?? null,
    },
    blueprint: {
      confirmed: confirmedScopes.has("blueprint"),
      dirty: unsyncedPlans > 0,
      dirtyCount: unsyncedPlans,
      lastConfirmedAt: confirmations.find(c => c.scope === "blueprint")?.createdAt?.toISOString() ?? null,
    },
  };
}

/** Confirm a single scope. Re-entrant: can be called multiple times. */
export async function confirmScope(
  novelId: string,
  scope: Scope,
  opts?: { mode?: "replace" | "merge" },
): Promise<void> {
  switch (scope) {
    case "story_seed":
      await confirmStorySeed(novelId);
      break;
    case "characters":
      await confirmCharacters(novelId);
      break;
    case "blueprint":
      await confirmBlueprint(novelId, opts);
      break;
  }
}

/** Confirm all scopes. Only syncs scopes that have actual changes (dirty=true). */
export async function confirmAllScopes(
  novelId: string,
  opts?: { mode?: "replace" | "merge" },
): Promise<Scope[]> {
  const status = await getConfirmationStatus(novelId);
  const confirmed: Scope[] = [];

  for (const scope of ALL_SCOPES) {
    const s = status[scope];
    if (!s.confirmed || s.dirty) {
      await confirmScope(novelId, scope, opts);
      confirmed.push(scope);
    }
  }

  return confirmed;
}

/** Remove confirmation for a scope (unconfirm). Drafts are NOT deleted. */
export async function unconfirmScope(novelId: string, scope: Scope): Promise<void> {
  const prisma = getPrisma();
  await prisma.confirmation.deleteMany({ where: { novelId, scope } });
}

/** Get the latest confirmation snapshot for a scope (used by contextAssembler). */
export async function getLatestSnapshot(novelId: string, scope: Scope): Promise<Record<string, unknown> | null> {
  const prisma = getPrisma();
  const conf = await prisma.confirmation.findUnique({ where: { novelId_scope: { novelId, scope } } });
  if (!conf?.snapshot) return null;
  try { return JSON.parse(conf.snapshot); } catch { return null; }
}

// ─── Internal: per-scope confirmation logic ─────────────

async function confirmStorySeed(novelId: string): Promise<void> {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({ where: { id: novelId } });
  if (!novel) throw new Error("Novel not found");

  // Read from DraftStorySeed (single source of truth for planning)
  const draftSeed = await prisma.draftStorySeed.findUnique({ where: { novelId } });
  let seedContent: Record<string, unknown> = {};

  if (draftSeed?.content) {
    try { seedContent = JSON.parse(draftSeed.content); } catch { /* ignore */ }
  }

  // Mark draft as synced
  if (draftSeed) {
    await prisma.draftStorySeed.update({ where: { novelId }, data: { synced: true } });
  }

  // Build snapshot from Novel fields (these are always live — genre, tone, etc.)
  let tags: string[] = [];
  if (novel.commercialTags) {
    tags = parseTags(novel.commercialTags);
  }

  const snapshot = {
    premise: seedContent.premise ?? "",
    mainArc: seedContent.mainArc ?? "",
    mysteryBox: seedContent.mysteryBox ?? "",
    endingDirection: seedContent.endingDirection ?? "",
    genre: novel.genre ?? null,
    narrativePov: novel.narrativePov ?? null,
    pacePreference: novel.pacePreference ?? null,
    styleTone: novel.styleTone ?? null,
    emotionIntensity: novel.emotionIntensity ?? null,
    targetAudience: novel.targetAudience ?? null,
    bookSellingPoint: novel.bookSellingPoint ?? null,
    competingFeel: novel.competingFeel ?? null,
    first30ChapterPromise: novel.first30ChapterPromise ?? null,
    commercialTags: tags,
    frozenAt: new Date().toISOString(),
  };

  await prisma.confirmation.upsert({
    where: { novelId_scope: { novelId, scope: "story_seed" } },
    create: { novelId, scope: "story_seed", snapshot: JSON.stringify(snapshot) },
    update: { snapshot: JSON.stringify(snapshot) },
  });
}

async function confirmCharacters(novelId: string): Promise<void> {
  const prisma = getPrisma();

  // Delegate DraftChar → NovelChar + DraftRel → NovelRel sync to shared helpers
  await syncDraftCharactersToWriting(novelId);
  await syncDraftRelationsToWriting(novelId);

  // Snapshot characters for contextAssembler
  const chars = await prisma.novelCharacter.findMany({ where: { novelId }, take: 50 });
  const relations = await prisma.novelCharacterRelation.findMany({ where: { novelId }, take: 100 });
  const snapshot = {
    characters: chars.map(c => ({
      name: c.name, role: c.role, personality: c.personality, background: c.background,
      appearance: c.appearance, quirks: c.quirks, currentStatus: c.currentStatus,
      currentGoal: c.currentGoal, voiceTexture: c.voiceTexture,
      identityLabel: c.identityLabel, factionLabel: c.factionLabel, prohibitions: c.prohibitions,
    })),
    relations: relations.map(r => ({
      sourceName: chars.find(ch => ch.id === r.sourceCharacterId)?.name ?? "",
      targetName: chars.find(ch => ch.id === r.targetCharacterId)?.name ?? "",
      type: r.type, summary: r.summary,
    })),
    frozenAt: new Date().toISOString(),
  };

  await prisma.confirmation.upsert({
    where: { novelId_scope: { novelId, scope: "characters" } },
    create: { novelId, scope: "characters", snapshot: JSON.stringify(snapshot) },
    update: { snapshot: JSON.stringify(snapshot) },
  });
}

async function confirmBlueprint(
  novelId: string,
  opts?: { mode?: "replace" | "merge" },
): Promise<void> {
  const prisma = getPrisma();

  // Sync DraftPlans → VolumeChapterPlan + Chapter
  await syncDraftPlansToWriting(novelId, opts);

  // Build blueprint snapshot from Volume + VolumeChapterPlan (DB ground truth)
  const dbVolumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" },
    include: {
      chapterPlans: { orderBy: { chapterOrder: "asc" } },
      draftPlans: { orderBy: { chapterOrder: "asc" } },
    },
  });
  if (dbVolumes.length === 0) throw new Error("No volumes to confirm — generate blueprint first");

  const volumes = dbVolumes.map(v => ({
    sortOrder: v.sortOrder, title: v.title, summary: v.summary ?? "",
    chapters: v.chapterPlans.length > 0
      ? v.chapterPlans.map(cp => ({
          order: cp.chapterOrder, title: cp.title, summary: cp.summary ?? "",
          coreEvent: cp.purpose ?? "", hook: cp.endingState ?? "",
          characters: [] as string[],
          conflictLevel: cp.conflictLevel ?? 5, revealLevel: cp.revealLevel ?? 5,
        }))
      : v.draftPlans.map(dp => ({
          order: dp.chapterOrder, title: dp.title, summary: dp.summary ?? "",
          coreEvent: "", hook: "",
          characters: [] as string[],
          conflictLevel: 5, revealLevel: 5,
        })),
  }));

  // Snapshot existing beat sheets
  const beatSheets: Record<number, unknown> = {};
  try {
    const dbVolumes = await prisma.volume.findMany({ where: { novelId }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } } });
    for (const vol of dbVolumes) {
      if (vol.chapterPlans.some(p => p.purpose || p.taskSheet)) {
        beatSheets[vol.sortOrder] = {
          beats: vol.chapterPlans.map(p => {
            let extra = { conflict: "", reveal: "", emotionBeat: "" };
            try { if (p.taskSheet) extra = JSON.parse(p.taskSheet); } catch { /* ignore */ }
            return { chapter: p.chapterOrder, beatType: inferBeat(p.conflictLevel ?? 0, p.revealLevel ?? 0), goal: p.purpose ?? "", conflict: extra.conflict, reveal: extra.reveal, emotionBeat: extra.emotionBeat };
          }),
          structureDiagnosis: "",
        };
      }
    }
  } catch { /* ignore */ }

  const snapshot = {
    volumes,
    beatSheets: Object.keys(beatSheets).length > 0 ? beatSheets : undefined,
    frozenAt: new Date().toISOString(),
  };

  await prisma.confirmation.upsert({
    where: { novelId_scope: { novelId, scope: "blueprint" } },
    create: { novelId, scope: "blueprint", snapshot: JSON.stringify(snapshot) },
    update: { snapshot: JSON.stringify(snapshot) },
  });
}

// ─── Helpers ────────────────────────────────────────────

function inferBeat(conflict: number, reveal: number): string {
  if (conflict >= 8) return "pressure";
  if (reveal >= 8) return "turn";
  if (reveal >= 7) return "payoff";
  if (conflict <= 3 && reveal <= 3) return "cooldown";
  if (conflict <= 4) return "setup";
  return "progress";
}
