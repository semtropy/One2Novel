import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getEnv } from "../config/env";

export type LLMProvider = "deepseek" | "openai" | "anthropic" | "gemini" | "qwen" | "moonshot";

export interface ProviderModel {
  provider: LLMProvider;
  models: string[];
}

/** All supported providers and their available models */
export const PROVIDER_MODELS: ProviderModel[] = [
  { provider: "deepseek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { provider: "openai", models: ["gpt-5-mini", "gpt-5", "gpt-4o"] },
  { provider: "anthropic", models: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"] },
  { provider: "gemini", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
  { provider: "qwen", models: ["qwen-plus", "qwen-max"] },
  { provider: "moonshot", models: ["moonshot-v1-8k", "moonshot-v1-32k"] },
];

export function createLLM(provider: LLMProvider, options?: { model?: string; temperature?: number; maxTokens?: number; responseFormat?: "json_object" }) {
  const env = getEnv();
  const model = options?.model;
  const temperature = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;

  switch (provider) {
    // ── OpenAI-compatible providers ──
    case "deepseek":
      return new ChatOpenAI({
        model: model ?? env.DEEPSEEK_MODEL,
        temperature, maxTokens, timeout: 120000,
        apiKey: env.DEEPSEEK_API_KEY,
        configuration: { baseURL: env.DEEPSEEK_BASE_URL },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });

    case "openai":
      return new ChatOpenAI({
        model: model ?? env.OPENAI_MODEL,
        temperature, maxTokens, timeout: 120000,
        apiKey: env.OPENAI_API_KEY,
        configuration: { baseURL: env.OPENAI_BASE_URL },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });

    case "qwen": {
      const apiKey = env.QWEN_API_KEY ?? env.DEEPSEEK_API_KEY;
      return new ChatOpenAI({
        model: model ?? "qwen-plus",
        temperature, maxTokens, timeout: 120000,
        apiKey, configuration: { baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });
    }

    case "moonshot": {
      const apiKey = env.MOONSHOT_API_KEY ?? env.OPENAI_API_KEY;
      return new ChatOpenAI({
        model: model ?? "moonshot-v1-8k",
        temperature, maxTokens, timeout: 120000,
        apiKey, configuration: { baseURL: "https://api.moonshot.cn/v1" },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });
    }

    // ── Anthropic ──
    case "anthropic":
      return new ChatAnthropic({
        modelName: model ?? env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        temperature, maxTokens,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
      });

    // ── Gemini ──
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Gemini API key not configured");
      return new ChatGoogleGenerativeAI({
        model: model ?? "gemini-2.5-flash",
        temperature, maxOutputTokens: maxTokens,
        apiKey,
      });
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
