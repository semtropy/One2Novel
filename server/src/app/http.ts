import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getEnv } from "../platform/config/env";
import { errorMiddleware } from "../platform/errors/errorMiddleware";
import { registerRoutes } from "./routes";

export function createApp() {
  const env = getEnv();
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  registerRoutes(app);
  app.use(errorMiddleware);

  return app;
}
