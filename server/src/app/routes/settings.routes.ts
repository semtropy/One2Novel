import { Router, type Request, type Response, type NextFunction } from "express";
import { getEnv, reloadEnv } from "../../platform/config/env";
import { getPreferences, savePreferences, saveApiKey } from "../../platform/config/preferences";
import { setSetting } from "../../modules/settings/runtimeSettings";
import { createLLM } from "../../platform/llm/provider";
import type { LLMProvider } from "../../platform/llm/provider";
import {
  PROVIDER_REGISTRY,
  resolveProviderBaseUrl,
  resolveProviderModel,
  isProviderConfigured,
  getAllProviderConfigs,
} from "../../platform/config/providers";
import { HumanMessage } from "@langchain/core/messages";

const router = Router();

// Settings — masked API keys (all 6 providers)
router.get("/settings", (_req, res) => {
  const env = getEnv();
  const keys: Record<string, string> = {};
  for (const cfg of getAllProviderConfigs()) {
    const key = env[cfg.apiKeyEnv as keyof typeof env] as string | undefined;
    keys[cfg.apiKeyEnv] = key ? "***" + key.slice(-4) : "";
  }
  res.json({ data: keys });
});

router.post("/settings", (req, res) => {
  const { key, provider } = req.body;
  if (key && provider) {
    const config = PROVIDER_REGISTRY[provider as LLMProvider];
    if (config) {
      setSetting(config.apiKeyEnv, key);
      saveApiKey(provider, key);
    }
  }
  reloadEnv();
  res.json({ data: { ok: true } });
});

// Provider list — all 6 providers from registry
router.get("/settings/providers", (_req, res) => {
  const env = getEnv();
  const prefs = getPreferences().preferences;
  const models = prefs.providerModels ?? {};

  const providerList = getAllProviderConfigs().map(cfg => ({
    provider: cfg.id,
    name: cfg.displayName,
    defaultModel: resolveProviderModel(env as unknown as Record<string, unknown>, cfg.id),
    currentModel: (models as Record<string, string>)[cfg.id] || "",
    maskedKey: (env[cfg.apiKeyEnv as keyof typeof env] as string | undefined)
      ? "***" + ((env[cfg.apiKeyEnv as keyof typeof env] as string) ?? "").slice(-4)
      : "",
    isConfigured: isProviderConfigured(env as unknown as Record<string, unknown>, cfg.id),
  }));

  res.json({ data: providerList });
});

// Test provider connectivity
router.post("/settings/providers/:provider/test", async (req, res, next) => {
  try {
    const provider = req.params.provider as LLMProvider;
    const config = PROVIDER_REGISTRY[provider];
    if (!config) {
      res.status(400).json({ error: { code: "INVALID_PROVIDER", message: "不支持的提供商" } });
      return;
    }

    const env = getEnv();
    const apiKey = env[config.apiKeyEnv as keyof typeof env] as string;
    if (!apiKey) {
      res.json({ data: { ok: false, error: "API Key 未配置" } });
      return;
    }

    // Create LLM instance and test
    const llm = createLLM(provider, { model: config.defaultModel });
    const result = await llm.invoke([new HumanMessage("Say OK")]);
    res.json({ data: { ok: true, provider: config.displayName, model: result.response_metadata?.model_name ?? config.defaultModel } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "测试失败";
    res.json({ data: { ok: false, error: msg } });
  }
});

// ─── Preferences CRUD ───────────────────────────────────

router.get("/preferences", (_req, res) => {
  res.json({ data: getPreferences() });
});

router.post("/preferences", (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "key required" } });
    return;
  }
  savePreferences({ [key]: value });
  res.json({ data: getPreferences() });
});

// ─── Per-Provider Config Save ──────────────────────────────

router.post("/settings/providers/:provider", (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = req.params.provider as LLMProvider;
    const config = PROVIDER_REGISTRY[provider];
    if (!config) {
      res.status(400).json({ error: { code: "INVALID_PROVIDER", message: "不支持的提供商" } });
      return;
    }
    const { key, model } = req.body;
    if (key) {
      setSetting(config.apiKeyEnv, key);
      saveApiKey(provider, key);
    }
    if (model) {
      const prefs = getPreferences();
      const models = { ...(prefs.preferences.providerModels ?? {}), [provider]: model };
      savePreferences({ providerModels: models });
    }
    if (key) reloadEnv();
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

export default router;
