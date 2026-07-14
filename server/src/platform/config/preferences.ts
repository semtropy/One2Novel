import fs from "node:fs";
import path from "node:path";
import { resolveDataRoot } from "../../platform/config/appPaths";
import { DEFAULT_CHAPTER_LENGTH } from "@one2novel/shared";

const PREFS_FILE = path.join(resolveDataRoot(), "user-preferences.json");

export interface UserPreferences {
  version: number;
  updatedAt: string;
  /** @deprecated Legacy v1 fields — migrated to preferences.* in v2. Read for backward compat only. */
  writingPov?: string;
  pacePreference?: string;
  styleTone?: string;
  favoriteGenre?: string;
  defaultChapterLength?: number;
  estimatedChapterCount?: number;
  preferences: {
    favoriteGenres: string[];
    preferredPerspective: string;
    preferredPace: string;
    preferredTone: string;
    estimatedChapterCount: number | null;
    defaultChapterLength: number | null;
    creationHistory: Array<{ title: string; genre: string; createdAt: string }>;
    defaultProvider?: string; // "deepseek" | "openai" | "anthropic" | "gemini" | "qwen" | "moonshot"
    providerModels?: Record<string, string>;
    /** Persisted API keys (masked on read from API, loaded to process.env on boot) */
    apiKeys?: Record<string, string>;
  };
}

const defaults: UserPreferences = {
  version: 2,
  updatedAt: new Date().toISOString(),
  preferences: {
    favoriteGenres: [],
    preferredPerspective: "third_person",
    preferredPace: "balanced",
    preferredTone: "dramatic",
    estimatedChapterCount: null,
    defaultChapterLength: DEFAULT_CHAPTER_LENGTH,
    creationHistory: [],
    providerModels: {},
    apiKeys: {},
  },
};

export function getPreferences(): UserPreferences {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const raw = fs.readFileSync(PREFS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed, preferences: { ...defaults.preferences, ...parsed.preferences } };
    }
  } catch (e) {
    console.error(`[Preferences] Failed to read preferences: ${e instanceof Error ? e.message : e}`);
  }
  return { ...defaults };
}

export function savePreferences(prefs: Partial<UserPreferences["preferences"]>): UserPreferences {
  const current = getPreferences();
  const updated: UserPreferences = {
    version: 2,
    updatedAt: new Date().toISOString(),
    preferences: { ...current.preferences, ...prefs },
  };
  try {
    fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
    fs.writeFileSync(PREFS_FILE, JSON.stringify(updated, null, 2), "utf-8");
  } catch (e) {
    console.error(`[Preferences] Failed to write preferences: ${e instanceof Error ? e.message : e}`);
  }
  return updated;
}

/**
 * Load persisted API keys from preferences.
 * Returns a map of { [providerId]: rawKey } instead of modifying process.env directly.
 * Callers decide how to use the returned keys.
 */
export function loadApiKeysFromPreferences(): Record<string, string> {
  try {
    const prefs = getPreferences();
    return prefs.preferences.apiKeys ?? {};
  } catch (e) {
    console.error(`[Preferences] Failed to load API keys: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

/** Save a single provider's API key to preferences */
export function saveApiKey(provider: string, key: string): void {
  const prefs = getPreferences();
  const apiKeys = { ...(prefs.preferences.apiKeys ?? {}), [provider]: key };
  savePreferences({ apiKeys });
}

export function recordCreation(novel: { title: string; genre?: string; createdAt: string | Date }) {
  const createdAt = typeof novel.createdAt === "string" ? novel.createdAt : novel.createdAt.toISOString();
  const current = getPreferences();
  const history = current.preferences.creationHistory.slice(0, 9);
  history.unshift({ title: novel.title, genre: novel.genre ?? "", createdAt });
  const genres = [...current.preferences.favoriteGenres];
  if (novel.genre && !genres.includes(novel.genre)) {
    genres.unshift(novel.genre);
  }
  savePreferences({ creationHistory: history, favoriteGenres: genres.slice(0, 5) });
}
