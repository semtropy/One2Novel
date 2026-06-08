import { createApp } from "./app/http";
import { getEnv } from "./platform/config/env";
import "./modules/novel/production/events";  // Register event handlers

const env = getEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[One2Novel] Server running on http://localhost:${env.PORT}`);
  console.log(`[One2Novel] API: http://localhost:${env.PORT}/api`);
});
