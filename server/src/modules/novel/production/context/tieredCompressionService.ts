/**
 * Tiered Compression Service — manages long-form novel memory via layered summarization.
 *
 * Tier architecture:
 *   Tier 0 — Hard Rules (always kept): book contract, character hard facts, style, world rules
 *   Tier 1 — Adjacent Chapters (last 3 chapters, ~500 chars each): detailed recent context
 *   Tier 2 — Recent Skeleton (chapters 4-10 behind current, ~150 chars each): key events only
 *   Tier 3 — Volume Summary (previous volume, ~2000 chars): compressed but coherent
 *   Tier 4 — Archive (earlier volumes, 1-2 sentences each): historical backbone
 */
import { getPrisma } from "../../../../platform/db/client";
import { aiInvoke } from "../../../../platform/llm/aiService";
import { z } from "zod";

// ─── Types ─────────────────────────────────────────────

export interface VolumeCompressionResult {
  volumeOrder: number;
  volumeTitle: string;
  summary: string;                  // ~2000 chars — the volume-level summary
  keyEvents: string[];              // 3-5 key events
  characterChanges: string[];       // Which characters changed, how
  unresolvedPayoffs: string[];      // Payoffs planted but not yet resolved
  archiveDigest: string;            // 1-2 sentence historical digest
}

export interface TieredContext {
  tier1Adjacent: string;            // Last 3 chapters, detailed excerpts
  tier2Recent: string;              // Chapters 4-10 behind current
  tier3VolumeSummary: string;       // Previous volume's full summary
  tier4Archive: string;             // All earlier volumes, 1-2 sentences each
}

// ─── LLM Schema ────────────────────────────────────────

const VolumeCompressionSchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()),
  characterChanges: z.array(z.string()),
  unresolvedPayoffs: z.array(z.string()),
  archiveDigest: z.string(),
});

// ─── Public API ─────────────────────────────────────────

/**
 * Compress a completed volume into a structured summary.
 * Called after the last chapter of a volume is completed.
 */
export async function compressVolume(
  novelId: string,
  volumeOrder: number,
): Promise<VolumeCompressionResult> {
  const prisma = getPrisma();
  const volume = await prisma.volume.findFirst({
    where: { novelId, sortOrder: volumeOrder },
    include: {
      chapterPlans: {
        orderBy: { chapterOrder: "asc" },
        include: { chapter: { select: { content: true, chapterSummary: true } } },
      },
    },
  });
  if (!volume) throw new Error(`Volume ${volumeOrder} not found`);

  // Collect chapter summaries as compression input
  const chapterTexts = volume.chapterPlans
    .map(cp => {
      const summary = cp.chapter?.chapterSummary?.summary
        ?? cp.chapter?.content?.slice(0, 500)
        ?? cp.summary
        ?? "";
      return `第${cp.chapterOrder}章《${cp.title}》：${summary}`;
    })
    .join("\n");

  const raw = await aiInvoke({
    assetId: "novel.volume.compress",
    novelId,
    userPrompt: [
      `请为以下卷生成压缩摘要：`,
      `卷名：《${volume.title}》`,
      volume.summary ? `卷概要：${volume.summary}` : "",
      `章节内容：\n${chapterTexts.slice(0, 8000)}`,
    ].filter(Boolean).join("\n"),
    schema: VolumeCompressionSchema,
    temperature: 0.4,
  });

  // Store archive digest separately; preserve the original volume summary
  await prisma.volume.update({
    where: { id: volume.id },
    data: {
      openingHook: raw.archiveDigest, // 1-2 sentence digest stored in separate field
    },
  });

  return {
    volumeOrder,
    volumeTitle: volume.title,
    summary: raw.summary,
    keyEvents: raw.keyEvents,
    characterChanges: raw.characterChanges,
    unresolvedPayoffs: raw.unresolvedPayoffs,
    archiveDigest: raw.archiveDigest,
  };
}

/**
 * Build tiered context for a chapter being written in a long-form novel.
 * This replaces the flat `recent_chapters` strategy for long mode.
 */
export async function buildTieredContext(
  novelId: string,
  currentChapterOrder: number,
): Promise<TieredContext> {
  const prisma = getPrisma();

  // Tier 1: Last 3 chapters, detailed excerpts (~500 chars each)
  const tier1Chapters = await prisma.chapter.findMany({
    where: { novelId, order: { lt: currentChapterOrder }, chapterStatus: "completed" },
    orderBy: { order: "desc" },
    take: 3,
    select: { order: true, title: true, content: true, chapterSummary: { select: { summary: true } } },
  });
  const tier1Adjacent = tier1Chapters.reverse().map(ch => {
    const excerpt = ch.chapterSummary?.summary
      ?? ch.content?.slice(0, 500)?.replace(/<[^>]*>/g, "")
      ?? "";
    return `第${ch.order}章《${ch.title}》：${excerpt.slice(0, 500)}`;
  }).join("\n\n");

  // Tier 2: Chapters 4-10 behind current, skeleton only (~150 chars each)
  const tier2Chapters = await prisma.chapter.findMany({
    where: { novelId, order: { gte: currentChapterOrder - 10, lt: currentChapterOrder - 3 }, chapterStatus: "completed" },
    orderBy: { order: "desc" },
    take: 7,
    select: { order: true, title: true, chapterSummary: { select: { summary: true } }, expectation: true },
  });
  const tier2Recent = tier2Chapters.reverse().map(ch => {
    const brief = ch.chapterSummary?.summary?.slice(0, 150) ?? ch.expectation ?? "";
    return `第${ch.order}章《${ch.title}》：${brief}`;
  }).join("\n");

  // Tier 3: Previous volume's summary
  const currentVolumePlan = await prisma.volumeChapterPlan.findFirst({
    where: { volume: { novelId }, chapter: { order: currentChapterOrder } },
    include: { volume: true },
  });
  const prevVolumeOrder = (currentVolumePlan?.volume.sortOrder ?? 1) - 1;
  let tier3VolumeSummary = "";
  if (prevVolumeOrder >= 1) {
    const prevVolume = await prisma.volume.findFirst({
      where: { novelId, sortOrder: prevVolumeOrder },
      select: { title: true, summary: true },
    });
    if (prevVolume) {
      tier3VolumeSummary = `上一卷「${prevVolume.title}」摘要：${prevVolume.summary ?? "（无摘要）"}`;
    }
  }

  // Tier 4: Archive — earlier volumes, 1-2 sentences each
  const archiveVolumes = await prisma.volume.findMany({
    where: { novelId, sortOrder: { lt: prevVolumeOrder } },
    orderBy: { sortOrder: "asc" },
    select: { sortOrder: true, title: true, summary: true },
  });
  const tier4Archive = archiveVolumes.map(v =>
    `第${v.sortOrder}卷「${v.title}」：${(v.summary ?? "").slice(0, 100)}`
  ).join("\n");

  return { tier1Adjacent, tier2Recent, tier3VolumeSummary, tier4Archive };
}
