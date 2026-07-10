import { getEnv } from "../config/env";
import type { LLMProvider } from "./provider";
import {
  PROVIDER_REGISTRY,
  resolveProviderBaseUrl,
  resolveProviderModel,
  isProviderConfigured,
  getAllProviderConfigs,
  type ProviderConfig,
} from "../config/providers";

interface LLMConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
}

/** Probe endpoints for each provider type — derived from registry */
const PROBE_CONFIG: Record<LLMProvider, { baseUrl: string; apiKey: string; model: string }> = {
  deepseek:  { baseUrl: "https://api.deepseek.com/v1",     apiKey: "", model: "" },
  openai:    { baseUrl: "https://api.openai.com/v1",        apiKey: "", model: "" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1",     apiKey: "", model: "" },
  gemini:    { baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", model: "" },
  qwen:      { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", apiKey: "", model: "" },
  moonshot:  { baseUrl: "https://api.moonshot.cn/v1",       apiKey: "", model: "" },
};

function resolveProbeConfig(provider: LLMProvider) {
  const env = getEnv();
  return {
    baseUrl: resolveProviderBaseUrl(env as unknown as Record<string, unknown>, provider),
    apiKey: env[PROVIDER_REGISTRY[provider].apiKeyEnv as keyof typeof env] as string,
    model: resolveProviderModel(env as unknown as Record<string, unknown>, provider),
  };
}

async function probeProvider(provider: LLMProvider): Promise<LLMConnectionResult> {
  const { baseUrl, apiKey, model } = resolveProbeConfig(provider);
  if (!apiKey) {
    return { ok: false, provider, model, error: "API key not configured" };
  }
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      return { ok: true, provider, model };
    }
    return { ok: false, provider, model, error: `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      provider,
      model,
      error: e instanceof Error ? e.message : "Connection failed",
    };
  }
}

/** Probe ALL configured providers and return results sorted by reachable first */
export async function probeAllLLM(): Promise<LLMConnectionResult[]> {
  const env = getEnv();
  const configured: LLMProvider[] = [];

  for (const cfg of getAllProviderConfigs()) {
    if (isProviderConfigured(env as unknown as Record<string, unknown>, cfg.id)) {
      configured.push(cfg.id);
    }
  }

  if (!configured.length) {
    return [{ ok: false, provider: "none", model: "", error: "No API key configured for any provider" }];
  }

  const results = await Promise.all(configured.map(probeProvider));
  return results;
}

/** Legacy single-provider probe — replaced by probeAllLLM */
export async function probeLLM(): Promise<LLMConnectionResult> {
  const results = await probeAllLLM();
  const reachable = results.find(r => r.ok);
  return reachable ?? results[0];
}
