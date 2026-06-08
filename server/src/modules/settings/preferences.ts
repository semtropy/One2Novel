import fs from "node:fs";
import path from "node:path";

const PREFS_FILE = path.resolve("user-preferences.json");

export interface UserPreferences {
  version: number;
  updatedAt: string;
  preferences: {
    favoriteGenres: string[];
    preferredPerspective: string;
    preferredPace: string;
    preferredTone: string;
    typicalChapterCount: number | null;
    defaultChapterLength: number | null;
    creationHistory: Array<{ title: string; genre: string; createdAt: string }>;
    defaultProvider?: "deepseek" | "openai" | "anthropic";
    providerModels?: Record<string, string>;
  };
}

const defaults: UserPreferences = {
  version: 1,
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
    version: 1,
    updatedAt: new Date().toISOString(),
    preferences: { ...current.preferences, ...prefs },
  };
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(updated, null, 2), "utf-8");
  } catch {}
  return updated;
}

export function recordCreation(novel: { title: string; genre?: string; createdAt: string | Date }) {
  const createdAt = typeof novel.createdAt === "string" ? novel.createdAt : novel.createdAt.toISOString();
  const current = getPreferences();
  const history = current.preferences.creationHistory.slice(0, 9);
  history.unshift({ title: novel.title, genre: novel.genre ?? "", createdAt });
  // Update genre frequency
  const genres = [...current.preferences.favoriteGenres];
  if (novel.genre && !genres.includes(novel.genre)) {
    genres.unshift(novel.genre);
  }
  savePreferences({ creationHistory: history, favoriteGenres: genres.slice(0, 5) });
}
