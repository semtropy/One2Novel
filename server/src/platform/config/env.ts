import dotenv from "dotenv";
import { z } from "zod";

// Load root .env first, then local .env (overrides if exists)
dotenv.config({ path: "../.env" });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("file:./dev.db"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com/v1"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  GEMINI_API_KEY: z.string().optional(),
  QWEN_API_KEY: z.string().optional(),
  MOONSHOT_API_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let _env: EnvConfig;

export function getEnv(): EnvConfig {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
