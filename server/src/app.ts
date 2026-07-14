import { createApp } from "./app/http";
import { getEnv } from "./platform/config/env";
import { loadApiKeysFromPreferences } from "./platform/config/preferences";
import "./modules/novel/prompts";            // Register all LLM prompts (must come after aiService.ts init)

// Restore persisted API keys on boot (desktop app restarts lose process.env)
const apiKeys = loadApiKeysFromPreferences();
for (const [provider, key] of Object.entries(apiKeys)) {
  if (key && !process.env[`${provider.toUpperCase()}_API_KEY`]) {
    process.env[`${provider.toUpperCase()}_API_KEY`] = key;
  }
}

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[One2Novel] Server running on http://localhost:${env.PORT}`);
  console.log(`[One2Novel] API: http://localhost:${env.PORT}/api`);
});
