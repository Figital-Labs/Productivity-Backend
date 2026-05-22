import express from "express";
import type { Express } from "express";

import { corsMiddleware } from "./middleware/cors.js";
import { errorMiddleware } from "./middleware/error.js";
import { healthRouter } from "./routes/health.routes.js";
import { v1Router } from "./routes/v1.js";

/**
 * Composes the Express app: middleware, routes, error handler.
 * Kept separate from `index.ts` so integration tests can construct the app
 * without binding a port. Future routes mount under `/api/v1`; health stays
 * unversioned (k8s convention).
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));

  // Health endpoints (unversioned).
  app.use(healthRouter);

  // Versioned API.
  app.use("/api/v1", v1Router);

  // Error handler last.
  app.use(errorMiddleware);

  return app;
}
