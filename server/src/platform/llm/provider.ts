import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getEnv } from "../config/env";
import {
  PROVIDER_REGISTRY,
  resolveProviderBaseUrl,
  resolveProviderModel,
  type ProviderId,
} from "../config/providers";

export type LLMProvider = ProviderId;

export interface ProviderModel {
  provider: LLMProvider;
  models: string[];
}

/** All supported providers and their available models — derived from registry */
export const PROVIDER_MODELS: ProviderModel[] = Object.values(PROVIDER_REGISTRY).map(cfg => ({
  provider: cfg.id,
  models: cfg.models,
}));

export function createLLM(
  provider: LLMProvider,
  options?: { model?: string; temperature?: number; maxTokens?: number; responseFormat?: "json_object" },
) {
  const env = getEnv();
  const model = options?.model ?? resolveProviderModel(env, provider);
  const temperature = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 8192;
  const config = PROVIDER_REGISTRY[provider];

  switch (config.category) {
    case "openai-compatible":
      return new ChatOpenAI({
        model,
        temperature,
        maxTokens,
        timeout: 120000,
        apiKey: env[config.apiKeyEnv as keyof typeof env] as string,
        configuration: { baseURL: resolveProviderBaseUrl(env, provider) },
        ...(options?.responseFormat === "json_object"
          ? { modelKwargs: { response_format: { type: "json_object" as const } } }
          : {}),
      });

    case "anthropic":
      return new ChatAnthropic({
        modelName: model,
        temperature,
        maxTokens,
        anthropicApiKey: env[config.apiKeyEnv as keyof typeof env] as string,
      });

    case "google": {
      const apiKey = env[config.apiKeyEnv as keyof typeof env] as string;
      if (!apiKey) throw new Error("Gemini API key not configured");
      return new ChatGoogleGenerativeAI({
        model,
        temperature,
        maxOutputTokens: maxTokens,
        apiKey,
      });
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
