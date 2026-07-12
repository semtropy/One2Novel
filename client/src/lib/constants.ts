const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHost(hostname: string | null | undefined): boolean {
  return Boolean(hostname) && LOOPBACK_HOSTS.has(String(hostname).toLowerCase());
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return (import.meta.env.VITE_API_BASE_URL?.trim() ?? "http://localhost:7456/api");
  }

  const config = (window as any).__ONE2NOVEL_RUNTIME__ ?? {};
  const env = (import.meta as any).env ?? {};
  const configuredBaseUrl = (config.apiBaseUrl ?? env.VITE_API_BASE_URL)?.trim();
  const isDev = env.DEV;
  const isDesktop = config.mode === "desktop";

  // Non-dev: use configured URL, or localhost for desktop, /api for web
  if (!isDev) {
    if (configuredBaseUrl) return configuredBaseUrl;
    return isDesktop ? "http://localhost:7456/api" : "/api";
  }

  // Dev web mode without configured URL
  if (!isDesktop && !configuredBaseUrl) return "/api";

  // Dev desktop mode: infer from window location
  const { protocol, hostname: host } = window.location;
  const inferredBaseUrl = `${protocol}//${host}:7456/api`;

  if (!configuredBaseUrl) return inferredBaseUrl;

  try {
    const parsed = new URL(configuredBaseUrl, window.location.origin);
    if (!isLoopbackHost(parsed.hostname) || isLoopbackHost(host)) {
      return trimTrailingSlash(parsed.toString());
    }
    parsed.hostname = host;
    if (!parsed.port) parsed.port = "7456";
    return trimTrailingSlash(parsed.toString());
  } catch {
    return configuredBaseUrl;
  }
}

export const APP_RUNTIME: "web" | "desktop" =
  (typeof window !== "undefined" && (window as any).__ONE2NOVEL_RUNTIME__?.mode === "desktop") ? "desktop" : "web";
export const APP_RUNTIME_IS_PACKAGED = typeof window !== "undefined" && !!(window as any).__ONE2NOVEL_RUNTIME__?.isPackaged;
export const APP_VERSION = (typeof window !== "undefined" && (window as any).__ONE2NOVEL_RUNTIME__?.appVersion?.trim()) || "0.0.0";
export const APP_RUNTIME_IS_PORTABLE = typeof window !== "undefined" && !!(window as any).__ONE2NOVEL_RUNTIME__?.isPortable;
export const APP_UPDATE_CHANNEL = (typeof window !== "undefined" && (window as any).__ONE2NOVEL_RUNTIME__?.updateChannel?.trim()) || "beta";

export const API_BASE_URL = resolveApiBaseUrl();

const DEFAULT_API_TIMEOUT_MS = 10 * 60 * 1000;

function parseApiTimeoutMs(rawValue: string | number | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_API_TIMEOUT_MS;
  return Math.floor(parsed);
}

export const API_TIMEOUT_MS = parseApiTimeoutMs(
  typeof window !== "undefined" ? (window as any).__ONE2NOVEL_RUNTIME__?.apiTimeoutMs : undefined,
);
