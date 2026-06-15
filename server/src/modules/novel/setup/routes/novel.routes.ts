import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { serializeTags, parseTags } from "../../../../platform/data/tagHelpers";
import { NovelCreateSchema, NovelUpdateSchema } from "@one2novel/shared/types/novel";
import { validate } from "../validate";
import { generateTitles } from "../titleService";
import { generateBookFraming } from "../bookFraming";
import { getPreferences, recordCreation } from "../../../settings/preferences";

const router = Router();

// List all novels
router.get("/", async (_req, res, next) => {
  try {
    const prisma = getPrisma();
    const novels = await prisma.novel.findMany({
      orderBy: { updatedAt: "desc" },
      include: { chapters: { orderBy: { order: "asc" } }, characters: true, volumes: { orderBy: { sortOrder: "asc" }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" } } } } },
    });
    // Parse JSON fields stored as strings in SQLite
    const parsed = novels.map(n => ({ ...n, commercialTags: parseTags(n.commercialTags) }));
    res.json({ data: parsed });
  } catch (e) { next(e); }
});

// Create novel
router.post("/", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const input = validate(NovelCreateSchema, req.body);
    const prefs = await getPreferences();
    const data: Record<string, unknown> = { ...input };
    // Legacy v1 preference fallbacks — read deprecated root-level fields for backward compat
    if (!data.narrativePov && prefs.writingPov) data.narrativePov = prefs.writingPov;
    if (!data.pacePreference && prefs.pacePreference) data.pacePreference = prefs.pacePreference;
    if (!data.styleTone && prefs.styleTone) data.styleTone = prefs.styleTone;
    if (!data.genre && prefs.favoriteGenre) data.genre = prefs.favoriteGenre;
    if (!data.defaultChapterLength && prefs.defaultChapterLength) data.defaultChapterLength = prefs.defaultChapterLength;
    if (!data.estimatedChapterCount && prefs.estimatedChapterCount) data.estimatedChapterCount = prefs.estimatedChapterCount;
    const novel = await prisma.novel.create({ data: { title: input.title, description: input.description, genre: data.genre as string | undefined, writingScale: (data.writingScale as string) ?? "long", narrativePov: data.narrativePov as "first_person" | "third_person" | "mixed" | undefined, pacePreference: data.pacePreference as string | undefined, styleTone: data.styleTone as string | undefined, defaultChapterLength: data.defaultChapterLength as number | undefined, estimatedChapterCount: data.estimatedChapterCount as number | undefined } });
    recordCreation({ title: novel.title, genre: novel.genre ?? undefined, createdAt: novel.createdAt });
    res.status(201).json({ data: novel });
  } catch (e) { next(e); }
});

// Get single novel
router.get("/:id", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({
      where: { id: req.params.id },
      include: {
        chapters: { orderBy: { order: "asc" } },
        characters: { orderBy: { name: "asc" } },
        volumes: { orderBy: { sortOrder: "asc" }, include: { chapterPlans: { orderBy: { chapterOrder: "asc" }, include: { chapter: { select: { id: true, title: true, content: true, chapterStatus: true } } } } } },
        timelineItems: { orderBy: { sortOrder: "asc" } },
        worldRules: { orderBy: { category: "asc" } },
        referenceBook: true,
        volumePresences: { orderBy: { volumeOrder: "asc" } },
      },
    });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
    // Parse JSON fields stored as strings in SQLite
    res.json({ data: { ...novel, commercialTags: parseTags(novel.commercialTags) } });
  } catch (e) { next(e); }
});

// Update novel
router.patch("/:id", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const input = validate(NovelUpdateSchema, req.body);
    // Serialize commercialTags (string[] in API → JSON string in DB)
    const dbInput: Record<string, unknown> = { ...input };
    if (input.commercialTags !== undefined) {
      dbInput.commercialTags = serializeTags(input.commercialTags);
    }
    const novel = await prisma.novel.update({ where: { id: req.params.id }, data: dbInput });
    res.json({ data: novel });
  } catch (e) { next(e); }
});

// Delete novel
router.delete("/:id", async (req, res, next) => {
  try {
    await getPrisma().novel.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) { next(e); }
});

// Generate titles
router.post("/:id/titles", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.id } });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "不存在" } }); return; }
    const result = await generateTitles({ description: novel.description ?? undefined, genre: novel.genre ?? undefined });
    res.json({ data: result });
  } catch (e) { next(e); }
});

// Generate book framing
router.post("/:id/framing", async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const novel = await prisma.novel.findUnique({ where: { id: req.params.id } });
    if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "不存在" } }); return; }
    const framing = await generateBookFraming({
      title: novel.title,
      description: novel.description ?? undefined,
      genre: novel.genre ?? undefined,
    });
    // Save framing back to the novel
    await prisma.novel.update({
      where: { id: req.params.id },
      data: {
        targetAudience: framing.targetAudience,
        commercialTags: serializeTags(framing.commercialTags ?? []),
        competingFeel: framing.competingFeel,
        bookSellingPoint: framing.bookSellingPoint,
        first30ChapterPromise: framing.first30ChapterPromise,
      },
    });
    res.json({ data: framing });
  } catch (e) { next(e); }
});

export default router;
