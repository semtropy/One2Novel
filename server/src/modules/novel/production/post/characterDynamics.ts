import { getPrisma } from "../../../../platform/db/client";

/**
 * @deprecated Use updateCharacterStatesAfterChapter() from characterStateUpdater.ts instead.
 * That function now handles both state updates AND relationship changes in a single AI call.
 * This wrapper remains for backward compatibility only — it delegates to the merged function.
 */
export async function updateCharacterDynamics(novelId: string, chapterId: string): Promise<void> {
  const prisma = getPrisma();
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter?.content) return;
  const { updateCharacterStatesAfterChapter } = await import("./characterStateUpdater");
  await updateCharacterStatesAfterChapter(novelId, chapter.content, chapter.order);
}
