import os from "node:os";
import path from "node:path";

export type AppRuntimeMode = "web" | "desktop";

const APP_NAME = "One2Novel";

function resolveConfiguredAppDataDir(): string | null {
  const configuredDir = process.env.ONE2NOVEL_APP_DATA_DIR?.trim();
  return configuredDir ? path.resolve(configuredDir) : null;
}

function resolveDefaultDesktopAppDataDir(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return path.join(localAppData, APP_NAME);
  }

  const appData = process.env.APPDATA?.trim();
  if (appData) {
    return path.join(appData, APP_NAME);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }

  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function resolveAppRuntimeMode(): AppRuntimeMode {
  return process.env.ONE2NOVEL_RUNTIME?.trim().toLowerCase() === "desktop" ? "desktop" : "web";
}

export function resolveAppDataRoot(): string {
  return resolveConfiguredAppDataDir() ?? resolveDefaultDesktopAppDataDir();
}

/** Data directory — desktop: %LOCALAPPDATA%/One2Novel/data, dev: server/ */
export function resolveDataRoot(): string {
  return resolveAppRuntimeMode() === "desktop"
    ? path.join(resolveAppDataRoot(), "data")
    : path.resolve(__dirname, "..", "..");
}

/** Resolve a database file path relative to the data root in desktop mode */
export function resolveDatabaseFilePath(rawUrl: string): string {
  if (resolveAppRuntimeMode() !== "desktop") {
    return rawUrl;
  }
  // file:./dev.db → %LOCALAPPDATA%/One2Novel/data/dev.db
  const relative = rawUrl.replace(/^file:/, "");
  if (path.isAbsolute(relative)) return rawUrl;
  const dataRoot = resolveDataRoot();
  return `file:${path.resolve(dataRoot, relative)}`;
}
