import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getEnv } from "../platform/config/env";
import { resolveAppRuntimeMode } from "../platform/config/appPaths";
import { errorMiddleware } from "../platform/errors/errorMiddleware";
import { requestErrorHandler } from "../platform/errors/requestErrorHandler";
import { registerRoutes } from "./routes";
import { getAllProviderConfigs } from "../platform/config/providers";

export function createApp() {
  const env = getEnv();
  const app = express();
  const isDesktop = resolveAppRuntimeMode() === "desktop";

  // CSP: strict in web mode; relaxed in desktop (file:// & data: URLs)
  if (isDesktop) {
    app.use(helmet({ contentSecurityPolicy: false }));
  } else {
    // Collect all allowed hostnames from the provider registry
    const allowedHosts = getAllProviderConfigs().map(cfg => {
      const url = new URL(cfg.defaultBaseUrl);
      return url.origin;
    });

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
            ...allowedHosts,
          ],
          fontSrc: ["'self'"],
        },
      },
    }));
  }

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "50mb" }));

  // Request context middleware — runs for ALL requests
  app.use(requestErrorHandler);

  registerRoutes(app);
  app.use(errorMiddleware);

  return app;
}
