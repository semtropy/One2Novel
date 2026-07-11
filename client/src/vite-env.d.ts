/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface Window {
  __ONE2NOVEL_RUNTIME__?: {
    mode?: "web" | "desktop";
    apiBaseUrl?: string;
    apiTimeoutMs?: number | string;
    isPackaged?: boolean;
    appVersion?: string;
    isPortable?: boolean;
    updateChannel?: string;
  };
}
