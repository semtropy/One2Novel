import { createApp } from "./app/http";
import { getEnv } from "./platform/config/env";
import { loadApiKeysFromPreferences } from "./modules/settings/preferences";
import "./modules/novel/production/events";  // Register event handlers

// Restore persisted API keys on boot (desktop app restarts lose process.env)
loadApiKeysFromPreferences();

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[One2Novel] Server running on http://localhost:${env.PORT}`);
  console.log(`[One2Novel] API: http://localhost:${env.PORT}/api`);
});
