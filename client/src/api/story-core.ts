/**
 * Story Core & Golden Finger API hooks — framing, story core, golden finger generation.
 * Split from api/novel.ts
 */
import { createMutationHook } from "./factory";

export interface BookFramingResult {
  targetAudience: string;
  commercialTags: string[];
  competingFeel: string;
  bookSellingPoint: string;
  first30ChapterPromise: string;
}

export interface StoryCoreResult {
  storySummary: string; centralQuestion: string; endingDirection: string;
  genre: string | null; narrativePov: string | null; pacePreference: string | null;
  styleTone: string | null; emotionIntensity: string | null;
}

export interface GoldenFingerResult {
  goldenFingerName: string;
  abilities: string[];
  limits: string[];
}

export const useGenerateFraming = createMutationHook<string, BookFramingResult>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/framing`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});

export const useGenerateStoryCore = createMutationHook<string, StoryCoreResult>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/story-core`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});

export const useGenerateGoldenFinger = createMutationHook<string, GoldenFingerResult>({
  method: "post",
  url: (novelId) => `/novels/${novelId}/golden-finger/generate`,
  body: () => undefined,
  invalidateKeys: (novelId) => [["novel", novelId]],
});
