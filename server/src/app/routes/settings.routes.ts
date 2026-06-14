import { Router } from "express";
import { getEnv, reloadEnv } from "../../platform/config/env";
import { getPreferences, savePreferences, saveApiKey } from "../../modules/settings/preferences";
import { createLLM } from "../../platform/llm/provider";
import { HumanMessage } from "@langchain/core/messages";

const router = Router();

// Settings
router.get("/settings", (_req, res) => {
  res.json({
    data: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? "***" + process.env.DEEPSEEK_API_KEY.slice(-4) : "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "***" + process.env.OPENAI_API_KEY.slice(-4) : "",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***" + process.env.ANTHROPIC_API_KEY.slice(-4) : "",
    },
  });
});

router.post("/settings", (req, res) => {
  const { key, provider } = req.body;
  if (key && provider) {
    process.env[`${provider.toUpperCase()}_API_KEY`] = key;
    saveApiKey(provider, key);
  }
  reloadEnv();
  res.json({ data: { ok: true } });
});

// Provider list
router.get("/settings/providers", (_req, res) => {
  const prefs = getPreferences().preferences;
  const models = prefs.providerModels ?? {};
  const envMap: Record<string, string> = {
    deepseek: getEnv().DEEPSEEK_MODEL,
    openai: getEnv().OPENAI_MODEL,
    anthropic: getEnv().ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  };
  const mask = (p: string) => {
    const k = process.env[p + "_API_KEY"];
    return k ? "***" + k.slice(-4) : "";
  };
  const providers = [
    { provider: "deepseek", name: "DeepSeek", defaultModel: envMap.deepseek, currentModel: models.deepseek || "", maskedKey: mask("DEEPSEEK"), isConfigured: !!process.env.DEEPSEEK_API_KEY },
    { provider: "openai", name: "OpenAI", defaultModel: envMap.openai, currentModel: models.openai || "", maskedKey: mask("OPENAI"), isConfigured: !!process.env.OPENAI_API_KEY },
    { provider: "anthropic", name: "Anthropic Claude", defaultModel: envMap.anthropic, currentModel: models.anthropic || "", maskedKey: mask("ANTHROPIC"), isConfigured: !!process.env.ANTHROPIC_API_KEY },
  ];
  res.json({ data: providers });
});

// Save provider config
router.post("/settings/providers/:provider", (req, res) => {
  const { key, model } = req.body;
  if (key) {
    process.env[`${req.params.provider.toUpperCase()}_API_KEY`] = key;
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

// Test single provider
router.post("/settings/providers/:provider/test", async (req, res) => {
  try {
    const provider = req.params.provider as "deepseek" | "openai" | "anthropic";
    const env = getEnv();
    const prefs = getPreferences().preferences;
    const models = prefs.providerModels ?? {};
    const model = models[provider] || (provider === "deepseek" ? env.DEEPSEEK_MODEL : provider === "openai" ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL);
    const start = Date.now();
    const llm = createLLM(provider, { model, temperature: 0, maxTokens: 10 });
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
