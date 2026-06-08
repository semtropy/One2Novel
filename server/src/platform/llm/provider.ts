import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { getEnv } from "../config/env";

export type LLMProvider = "openai" | "deepseek" | "anthropic";

export function createLLM(provider: LLMProvider, options?: { model?: string; temperature?: number; maxTokens?: number; responseFormat?: "json_object" }) {
  const env = getEnv();

  switch (provider) {
    case "deepseek":
      return new ChatOpenAI({
        model: options?.model ?? env.DEEPSEEK_MODEL,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 4096,
        timeout: 120000,
        apiKey: process.env.DEEPSEEK_API_KEY ?? env.DEEPSEEK_API_KEY,
        configuration: { baseURL: env.DEEPSEEK_BASE_URL },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });

    case "openai":
      return new ChatOpenAI({
        model: options?.model ?? env.OPENAI_MODEL,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 4096,
        timeout: 120000,
        apiKey: env.OPENAI_API_KEY,
        configuration: { baseURL: env.OPENAI_BASE_URL },
        ...(options?.responseFormat === "json_object" ? { modelKwargs: { response_format: { type: "json_object" as const } } } : {}),
      });

    case "anthropic":
      return new ChatAnthropic({
        modelName: options?.model ?? env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 4096,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY,
      });

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
