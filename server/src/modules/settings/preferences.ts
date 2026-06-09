import fs from "node:fs";
import path from "node:path";
import { resolveDataRoot } from "../../platform/config/appPaths";

const PREFS_FILE = path.join(resolveDataRoot(), "user-preferences.json");

export interface UserPreferences {
  version: number;
  updatedAt: string;
  preferences: {
    favoriteGenres: string[];
    preferredPerspective: string;
    preferredPace: string;
    preferredTone: string;
    typicalChapterCount: number | null;
    preferredVolumes?: number | null;
    preferredChaptersPerVolume?: number | null;
    defaultChapterLength: number | null;
    creationHistory: Array<{ title: string; genre: string; createdAt: string }>;
    defaultProvider?: "deepseek" | "openai" | "anthropic";
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
    preferredTone: "",
    typicalChapterCount: null,
    defaultChapterLength: 3000,
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
  } catch {}
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
  } catch {}
  return updated;
}

/** Load persisted API keys into process.env on server startup */
export function loadApiKeysFromPreferences(): void {
  try {
    const prefs = getPreferences();
    const keys = prefs.preferences.apiKeys ?? {};
    for (const [provider, key] of Object.entries(keys)) {
      if (key && !process.env[`${provider.toUpperCase()}_API_KEY`]) {
        process.env[`${provider.toUpperCase()}_API_KEY`] = key;
      }
    }
  } catch {}
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
