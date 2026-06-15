import { Router } from "express";
import { getEnv, reloadEnv } from "../../platform/config/env";
import { getPreferences, savePreferences, saveApiKey } from "../../modules/settings/preferences";
import { setSetting } from "../../modules/settings/runtimeSettings";
import { createLLM } from "../../platform/llm/provider";
import type { LLMProvider } from "../../platform/llm/provider";
import { HumanMessage } from "@langchain/core/messages";

const router = Router();

const ALL_PROVIDERS: Array<{ provider: LLMProvider; name: string }> = [
  { provider: "deepseek",  name: "DeepSeek" },
  { provider: "openai",    name: "OpenAI" },
  { provider: "anthropic", name: "Anthropic Claude" },
  { provider: "gemini",    name: "Google Gemini" },
  { provider: "qwen",      name: "通义千问" },
  { provider: "moonshot",  name: "Moonshot" },
];

function resolveDefaultModel(provider: LLMProvider): string {
  const env = getEnv();
  switch (provider) {
    case "deepseek":  return env.DEEPSEEK_MODEL;
    case "openai":    return env.OPENAI_MODEL;
    case "anthropic": return env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
    case "gemini":    return "gemini-2.5-flash";
    case "qwen":      return env.QWEN_MODEL ?? "qwen-plus";
    case "moonshot":  return env.MOONSHOT_MODEL ?? "moonshot-v1-8k";
  }
}

function maskKey(provider: LLMProvider): string {
  const key = getEnv()[`${provider.toUpperCase()}_API_KEY` as keyof ReturnType<typeof getEnv>] as string | undefined;
  return key ? "***" + key.slice(-4) : "";
}

// Settings — masked API keys (all 6 providers)
router.get("/settings", (_req, res) => {
  res.json({
    data: {
      DEEPSEEK_API_KEY: maskKey("deepseek"),
      OPENAI_API_KEY: maskKey("openai"),
      ANTHROPIC_API_KEY: maskKey("anthropic"),
      GEMINI_API_KEY: maskKey("gemini"),
      QWEN_API_KEY: maskKey("qwen"),
      MOONSHOT_API_KEY: maskKey("moonshot"),
    },
  });
});

router.post("/settings", (req, res) => {
  const { key, provider } = req.body;
  if (key && provider) {
    setSetting(`${provider.toUpperCase()}_API_KEY`, key);
    saveApiKey(provider, key);
  }
  reloadEnv();
  res.json({ data: { ok: true } });
});

// Provider list — all 6 providers
router.get("/settings/providers", (_req, res) => {
  const prefs = getPreferences().preferences;
  const models = prefs.providerModels ?? {};

  const env = getEnv();
  const providers = ALL_PROVIDERS.map(({ provider, name }) => {
    const envKey = `${provider.toUpperCase()}_API_KEY` as keyof typeof env;
    const configured = typeof env[envKey] === "string" && (env[envKey] as string).length > 0;
    return {
      provider,
      name,
      defaultModel: resolveDefaultModel(provider),
      currentModel: (models as Record<string, string>)[provider] || "",
      maskedKey: maskKey(provider),
      isConfigured: configured,
    };
  });

  res.json({ data: providers });
});

// Save provider config
router.post("/settings/providers/:provider", (req, res) => {
  const { key, model } = req.body;
  if (key) {
    setSetting(`${req.params.provider.toUpperCase()}_API_KEY`, key);
    saveApiKey(req.params.provider, key);
    reloadEnv();
  }
  if (model !== undefined) {
    const prefs = getPreferences();
    const providerModels = { ...(prefs.preferences.providerModels ?? {}), [req.params.provider]: model };
    savePreferences({ providerModels });
  }
  res.json({ data: { ok: true } });
});

// Test provider connection — all 6 providers
const VALID_PROVIDERS = new Set<string>(ALL_PROVIDERS.map(p => p.provider));

router.post("/settings/providers/:provider/test", async (req, res) => {
  const provider = req.params.provider;
  if (!VALID_PROVIDERS.has(provider)) {
    res.status(400).json({ error: { code: "INVALID_PROVIDER", message: `Unknown provider: ${provider}` } });
    return;
  }
  try {
    const env = getEnv();
    const prefs = getPreferences().preferences;
    const models = prefs.providerModels ?? {};
    const model = (models as Record<string, string>)[provider] || resolveDefaultModel(provider as LLMProvider);
    const start = Date.now();
    const llm = createLLM(provider as LLMProvider, { model, temperature: 0, maxTokens: 10 });
    await llm.invoke([new HumanMessage("Hi")]);
    res.json({ data: { ok: true, model, provider, latencyMs: Date.now() - start } });
  } catch (e) {
    res.json({ data: { ok: false, error: e instanceof Error ? e.message : "Connection failed" } });
  }
});

// Preferences
router.get("/preferences", (_req, res) => {
  res.json({ data: getPreferences() });
});

router.post("/preferences", (req, res) => {
  res.json({ data: savePreferences(req.body) });
});

export default router;
