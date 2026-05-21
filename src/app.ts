import express from "express";
import type { Express } from "express";

import { stubAuth } from "./middleware/auth.js";
import { errorMiddleware } from "./middleware/error.js";
import { healthRouter } from "./routes/health.routes.js";

/**
 * Composes the Express app: middleware, routes, error handler.
 * Kept separate from `index.ts` so integration tests can construct the app
 * without binding a port. Future routes mount under `/api/v1`; health stays
 * unversioned (k8s convention).
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Auth attaches req.user; everything downstream assumes it's present.
  app.use(stubAuth);

  // Health endpoints (unversioned).
  app.use(healthRouter);

  // Future: app.use("/api/v1", apiRouter);

  // Error handler last.
  app.use(errorMiddleware);

  return app;
}
