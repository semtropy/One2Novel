import { describe, it, expect } from "vitest";
import {
  NovelCreateSchema,
  NovelUpdateSchema,
  ChapterCreateSchema,
  ChapterUpdateSchema,
  NovelCharacterCreateSchema,
} from "@one2novel/shared/types/novel";

describe("Zod schema roundtrip", () => {
  it("NovelCreateSchema accepts valid input and rejects missing title", () => {
    const valid = { title: "Test Novel", genre: "仙侠" };
    const result = NovelCreateSchema.safeParse(valid);
    expect(result.success).toBe(true);

    const invalid = { genre: "仙侠" };
    const invalidResult = NovelCreateSchema.safeParse(invalid);
    expect(invalidResult.success).toBe(false);
    if (!invalidResult.success) {
      expect(invalidResult.error.issues[0].path[0]).toContain("title");
    }
  });

  it("NovelCreateSchema enforces length constraints", () => {
    const tooLong = NovelCreateSchema.safeParse({
      title: "a".repeat(201),
      description: "b".repeat(50001),
    });
    expect(tooLong.success).toBe(false);
  });

  it("NovelUpdateSchema allows partial updates", () => {
    const partial = { title: "Updated Title" };
    const result = NovelUpdateSchema.safeParse(partial);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Updated Title");
    }
  });

  it("ChapterCreateSchema validates order and word count", () => {
    const valid = { title: "Chapter 1", order: 0, targetWordCount: 3000 };
    const result = ChapterCreateSchema.safeParse(valid);
    expect(result.success).toBe(true);

    const tooFewWords = ChapterCreateSchema.safeParse({
      title: "Chapter 1",
      order: 0,
      targetWordCount: 100,
    });
    expect(tooFewWords.success).toBe(false);
  });

  it("ChapterUpdateSchema accepts status transitions", () => {
    const result = ChapterUpdateSchema.safeParse({
      chapterStatus: "completed",
    });
    expect(result.success).toBe(true);

    const invalidStatus = ChapterUpdateSchema.safeParse({
      chapterStatus: "deleted",
    });
    expect(invalidStatus.success).toBe(false);
  });

  it("NovelCharacterCreateSchema validates role enum", () => {
    const result = NovelCharacterCreateSchema.safeParse({
      name: "Hero",
      role: "protagonist",
    });
    expect(result.success).toBe(true);

    const badRole = NovelCharacterCreateSchema.safeParse({
      name: "Hero",
      role: "main_character",
    });
    expect(badRole.success).toBe(false);
  });

  it("Roundtrip: create → update → create schema", () => {
    const createData = {
      title: "My Novel",
      genre: "玄幻",
      writingScale: "long" as const,
    };
    const createResult = NovelCreateSchema.safeParse(createData);
    expect(createResult.success).toBe(true);
    if (createResult.success) {
      // The created data should also pass update schema
      const updateResult = NovelUpdateSchema.safeParse({
        title: createResult.data.title,
        genre: createResult.data.genre,
      });
      expect(updateResult.success).toBe(true);
    }
  });
});
