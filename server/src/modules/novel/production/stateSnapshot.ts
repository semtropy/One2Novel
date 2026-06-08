import { getPrisma } from "../../../platform/db/client";

interface SnapshotEntry {
  chapterOrder: number;
  chapterTitle: string;
  timestamp: string;
  characterStates: Array<{ name: string; goal?: string; location?: string }>;
  wordCount: number;
}

/** Get chapter-by-chapter state progression for visualization */
export async function getStateSnapshots(novelId: string): Promise<SnapshotEntry[]> {
  const prisma = getPrisma();
  const chapters = await prisma.chapter.findMany({
    where: { novelId, chapterStatus: { in: ["drafted", "completed"] } },
    orderBy: { order: "asc" },
    select: { order: true, title: true, content: true, actualWordCount: true, createdAt: true },
  });

  const characters = await prisma.novelCharacter.findMany({
    where: { novelId },
    select: { name: true, currentGoal: true, currentLocation: true },
  });

  return chapters.map((ch) => ({
    chapterOrder: ch.order,
    chapterTitle: ch.title,
    timestamp: ch.createdAt.toISOString(),
    characterStates: characters
      .filter((c) => c.currentGoal || c.currentLocation)
      .map((c) => ({ name: c.name, goal: c.currentGoal ?? undefined, location: c.currentLocation ?? undefined })),
    wordCount: ch.actualWordCount ?? (ch.content?.length ?? 0),
  }));
}
