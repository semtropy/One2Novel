import { getEnv } from "../config/env";

interface LLMConnectionResult {
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
}

export async function probeLLM(): Promise<LLMConnectionResult> {
  const env = getEnv();

  if (env.DEEPSEEK_API_KEY) {
    try {
      const res = await fetch(`${env.DEEPSEEK_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        return { ok: true, provider: "deepseek", model: env.DEEPSEEK_MODEL };
      }
      return { ok: false, provider: "deepseek", model: env.DEEPSEEK_MODEL, error: `HTTP ${res.status}` };
    } catch (e) {
      return {
        ok: false,
        provider: "deepseek",
        model: env.DEEPSEEK_MODEL,
        error: e instanceof Error ? e.message : "Unknown error",
      };
    }
  }

  return { ok: false, provider: "none", model: "", error: "No API key configured" };
}
