import { getEnv } from "../config/env";
import type { LLMProvider } from "./provider";

interface LLMConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
}

/** Probe endpoints for each provider type */
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
  switch (provider) {
    case "deepseek":
      return { baseUrl: env.DEEPSEEK_BASE_URL, apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL };
    case "openai":
      return { baseUrl: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL };
    case "anthropic":
      return { baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1", apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6" };
    case "gemini":
      return { baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: env.GEMINI_API_KEY, model: "gemini-2.5-flash" };
    case "qwen":
      return { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", apiKey: env.QWEN_API_KEY, model: env.QWEN_MODEL ?? "qwen-plus" };
    case "moonshot":
      return { baseUrl: "https://api.moonshot.cn/v1", apiKey: env.MOONSHOT_API_KEY, model: env.MOONSHOT_MODEL ?? "moonshot-v1-8k" };
  }
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
  if (env.DEEPSEEK_API_KEY) configured.push("deepseek");
  if (env.OPENAI_API_KEY) configured.push("openai");
  if (env.ANTHROPIC_API_KEY) configured.push("anthropic");
  if (env.GEMINI_API_KEY) configured.push("gemini");
  if (env.QWEN_API_KEY) configured.push("qwen");
  if (env.MOONSHOT_API_KEY) configured.push("moonshot");

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
