/**
 * Provider Configuration Registry — Single Source of Truth.
 *
 * All provider metadata (display names, model lists, base URLs, API key env var names,
 * default models) lives here. Every other module reads from this registry instead of
 * defining its own copies.
 *
 * Consumers:
 *   - server/src/platform/llm/provider.ts       → createLLM()
 *   - server/src/platform/llm/connectivity.ts   → PROBE_CONFIG, resolveProbeConfig()
 *   - server/src/app/routes/settings.routes.ts  → ALL_PROVIDERS, resolveDefaultModel()
 *   - server/src/platform/config/env.ts         → zod schema (keep for validation, but values come from registry)
 *   - client/src/pages/SettingsPage.tsx         → MODEL_OPTIONS (via /settings/providers API)
 */
/** Stable provider identifiers */
export type ProviderId = "deepseek" | "openai" | "anthropic" | "gemini" | "qwen" | "moonshot";

export interface ProviderConfig {
  /** Stable provider identifier (e.g. "deepseek", "openai") */
  id: ProviderId;
  /** Display name shown in the frontend settings UI */
  displayName: string;
  /** Environment variable name for the API key (e.g. "OPENAI_API_KEY") */
  apiKeyEnv: string;
  /** Environment variable name for the base URL (e.g. "OPENAI_BASE_URL") */
  baseUrlEnv: string;
  /** Environment variable name for the model (e.g. "OPENAI_MODEL") */
  modelEnv: string;
  /** All models available for this provider */
  models: string[];
  /** Default model when none is configured in env/preferences */
  defaultModel: string;
  /** Hardcoded fallback base URL (used when env var is empty) */
  defaultBaseUrl: string;
  /** Whether this provider supports JSON mode (structured output) */
  supportsJsonMode: boolean;
  /** Provider category: "openai-compatible" | "anthropic" | "google" */
  category: "openai-compatible" | "anthropic" | "google";
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderConfig> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    modelEnv: "DEEPSEEK_MODEL",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    supportsJsonMode: true,
    category: "openai-compatible",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    models: ["gpt-5-mini", "gpt-5", "gpt-4o"],
    defaultModel: "gpt-4.1-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    supportsJsonMode: true,
    category: "openai-compatible",
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic Claude",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    modelEnv: "ANTHROPIC_MODEL",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"],
    defaultModel: "claude-sonnet-4-6",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    supportsJsonMode: false,
    category: "anthropic",
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_BASE_URL",
    modelEnv: "GEMINI_MODEL",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    supportsJsonMode: false,
    category: "google",
  },
  qwen: {
    id: "qwen",
    displayName: "通义千问",
    apiKeyEnv: "QWEN_API_KEY",
    baseUrlEnv: "QWEN_BASE_URL",
    modelEnv: "QWEN_MODEL",
    models: ["qwen-plus", "qwen-max"],
    defaultModel: "qwen-plus",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    supportsJsonMode: true,
    category: "openai-compatible",
  },
  moonshot: {
    id: "moonshot",
    displayName: "月之暗面 Moonshot",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    modelEnv: "MOONSHOT_MODEL",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
    defaultModel: "moonshot-v1-8k",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    supportsJsonMode: true,
    category: "openai-compatible",
  },
};

/** All provider IDs in a stable order */
export const ALL_PROVIDER_IDS: ProviderId[] = [
  "deepseek", "openai", "anthropic", "gemini", "qwen", "moonshot",
];

/** Get config for a specific provider */
export function getProviderConfig(id: ProviderId): ProviderConfig {
  const config = PROVIDER_REGISTRY[id];
  if (!config) throw new Error(`Unknown provider: ${id}`);
  return config;
}

/** Get all provider configs */
export function getAllProviderConfigs(): ProviderConfig[] {
  return ALL_PROVIDER_IDS.map(id => PROVIDER_REGISTRY[id]);
}

/** Check if a provider has an API key configured */
export function isProviderConfigured(env: Record<string, unknown>, provider: ProviderId): boolean {
  const config = getProviderConfig(provider);
  const key = env[config.apiKeyEnv];
  return typeof key === "string" && key.length > 0;
}

/** Resolve the base URL for a provider — env var takes priority over hardcoded default */
export function resolveProviderBaseUrl(env: Record<string, unknown>, provider: ProviderId): string {
  const config = getProviderConfig(provider);
  const val = env[config.baseUrlEnv] as string | undefined;
  return val ?? config.defaultBaseUrl;
}

/** Resolve the model for a provider — env var takes priority over default */
export function resolveProviderModel(env: Record<string, unknown>, provider: ProviderId): string {
  const config = getProviderConfig(provider);
  const val = env[config.modelEnv] as string | undefined;
  return val ?? config.defaultModel;
}
