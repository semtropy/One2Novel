import { createQueryHook, createMutationHook } from "./factory";

export interface StyleProfile {
  id: string;
  name: string;
  sourceText?: string;
  extractedFeatures?: string;
  narrativeRules?: string;
  languageRules?: string;
  characterRules?: string;
  rhythmRules?: string;
  antiAiRules?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export const useStyleProfiles = createQueryHook<StyleProfile[], void>({
  queryKey: ["styles"],
  url: () => "/styles",
  enabled: () => true,
});

export const useCreateStyleProfile = createMutationHook<{ name: string; sourceText?: string }, StyleProfile>({
  method: "post",
  url: () => "/styles",
  invalidateKeys: () => [["styles"]],
});

export const useExtractStyle = createMutationHook<string, unknown>({
  method: "post",
  url: (profileId) => `/styles/${profileId}/extract`,
  body: () => undefined,
  invalidateKeys: () => [["styles"]],
});

export const useBindStyle = createMutationHook<{ profileId: string; targetType: string; targetId: string }, unknown>({
  method: "post",
  url: (input) => `/styles/${input.profileId}/bind`,
  body: (input) => ({ targetType: input.targetType, targetId: input.targetId }),
  invalidateKeys: () => [["styles"]],
});
