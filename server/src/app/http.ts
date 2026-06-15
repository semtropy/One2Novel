import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getEnv } from "../platform/config/env";
import { resolveAppRuntimeMode } from "../platform/config/appPaths";
import { errorMiddleware } from "../platform/errors/errorMiddleware";
import { registerRoutes } from "./routes";

export function createApp() {
  const env = getEnv();
  const app = express();
  const isDesktop = resolveAppRuntimeMode() === "desktop";

  // CSP: strict in web mode; relaxed in desktop (file:// & data: URLs)
  if (isDesktop) {
    app.use(helmet({ contentSecurityPolicy: false }));
  } else {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: [
            "'self'",
            "http://localhost:*",
            "https://api.deepseek.com",
            "https://api.openai.com",
            "https://api.anthropic.com",
            "https://generativelanguage.googleapis.com",
            "https://dashscope-intl.aliyuncs.com",
            "https://api.moonshot.cn",
          ],
          fontSrc: ["'self'"],
        },
      },
    }));
  }

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "50mb" }));

  registerRoutes(app);
  app.use(errorMiddleware);

  return app;
}
