import { Router } from "express";
import { getPrisma } from "../../../../platform/db/client";
import { createNovelRepo } from "../../../../platform/data/repositories";
import { serializeTags, parseTags } from "../../../../platform/data/tagHelpers";
import { NovelCreateSchema, NovelUpdateSchema } from "@one2novel/shared/types/novel";
import { validate } from "../validate";
import { AppError } from "../../../../platform/errors/AppError";
import { generateTitles } from "../titleService";
import { generateStoryCore } from "../../planning/storyCoreService";
import { getPreferences, recordCreation } from "../../../settings/preferences";
import { errorHandlerWrap } from "../../../../platform/errors/requestErrorHandler";

const router = Router();

// List all novels
router.get("/", errorHandlerWrap(async (req, res) => {
  const repo = createNovelRepo(getPrisma());
  const novels = await repo.findAll();
  const parsed = novels.map(n => ({ ...n, commercialTags: parseTags(n.commercialTags) }));
  res.json({ data: parsed });
}));

// Create novel
router.post("/", errorHandlerWrap(async (req, res) => {
  const repo = createNovelRepo(getPrisma());
  const input = validate(NovelCreateSchema, req.body);
  const prefs = await getPreferences();
  const data: Record<string, unknown> = { ...input };
  if (!data.narrativePov && prefs.writingPov) data.narrativePov = prefs.writingPov;
  if (!data.pacePreference && prefs.pacePreference) data.pacePreference = prefs.pacePreference;
  if (!data.styleTone && prefs.styleTone) data.styleTone = prefs.styleTone;
  if (!data.genre && prefs.favoriteGenre) data.genre = prefs.favoriteGenre;
  if (!data.defaultChapterLength && prefs.defaultChapterLength) data.defaultChapterLength = prefs.defaultChapterLength;
  if (!data.estimatedChapterCount && prefs.estimatedChapterCount) data.estimatedChapterCount = prefs.estimatedChapterCount;
  const novel = await repo.create({ title: input.title, description: input.description, genre: data.genre as string | undefined, writingScale: (data.writingScale as string) ?? "long", narrativePov: data.narrativePov as "first_person" | "third_person" | "mixed" | undefined, pacePreference: data.pacePreference as string | undefined, tonePitch: data.styleTone as string | undefined, defaultChapterLength: data.defaultChapterLength as number | undefined, estimatedChapterCount: data.estimatedChapterCount as number | undefined });
  recordCreation({ title: novel.title, genre: novel.genre ?? undefined, createdAt: novel.createdAt });
  res.status(201).json({ data: novel });
}));

// Get single novel
router.get("/:id", errorHandlerWrap(async (req, res) => {
  const repo = createNovelRepo(getPrisma());
  const novel = await repo.findFullById(String(req.params.id));
  if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Novel not found" } }); return; }
  res.json({ data: { ...novel, commercialTags: parseTags(novel.commercialTags) } });
}));

// Known updateable fields — rejects typos before they hit the DB silently
const NOVEL_FIELDS = new Set(Object.keys(NovelUpdateSchema.shape));

// Update novel
router.patch("/:id", errorHandlerWrap(async (req, res) => {
  const unknownKeys = Object.keys(req.body).filter(k => !NOVEL_FIELDS.has(k) && k !== "id");
  if (unknownKeys.length > 0) {
    throw new AppError(400, "UNKNOWN_FIELDS", `未知字段: ${unknownKeys.join("、")}`);
  }
  const repo = createNovelRepo(getPrisma());
  const input = validate(NovelUpdateSchema, req.body);
  const dbInput: Record<string, unknown> = { ...input };
  if (input.commercialTags !== undefined) {
    dbInput.commercialTags = serializeTags(input.commercialTags);
  }
  const novel = await repo.update(String(req.params.id), dbInput);
  res.json({ data: novel });
}));

// Delete novel
router.delete("/:id", errorHandlerWrap(async (req, res) => {
  const repo = createNovelRepo(getPrisma());
  await repo.delete(String(req.params.id));
  res.status(204).send();
}));

// Generate titles
router.post("/:id/titles", errorHandlerWrap(async (req, res) => {
  const repo = createNovelRepo(getPrisma());
  const novel = await repo.findById(String(req.params.id));
  if (!novel) { res.status(404).json({ error: { code: "NOT_FOUND", message: "不存在" } }); return; }
  const result = await generateTitles({ description: novel.description ?? undefined, genre: novel.genre ?? undefined });
  res.json({ data: result });
}));

// Generate book framing
router.post("/:id/framing", errorHandlerWrap(async (req, res) => {
  const result = await generateStoryCore(String(req.params.id));
  res.json({ data: result });
}));

export default router;
