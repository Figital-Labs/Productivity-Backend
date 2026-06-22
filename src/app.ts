import express from "express";
import type { Express } from "express";

import { log } from "./lib/logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorMiddleware } from "./middleware/error.js";
import { getRequestId, requestId } from "./middleware/request-id.js";
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
  app.use(requestId);
  app.use(express.json({ limit: "1mb" }));

  // Per-request completion log, logged BY SIGNIFICANCE so the signal isn't drowned by routine
  // polling: 5xx→error, 4xx→warn, mutations + slow (>1s) reads→info, routine GET reads→debug
  // (quiet unless LOG_LEVEL=debug). One line per request, no per-handler boilerplate.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const level: "debug" | "info" | "warn" | "error" =
        res.statusCode >= 500
          ? "error"
          : res.statusCode >= 400
            ? "warn"
            : req.method !== "GET" || durationMs >= 1000
              ? "info"
              : "debug";
      log[level]("http", `${req.method} ${req.originalUrl} → ${res.statusCode.toString()}`, {
        requestId: getRequestId(res),
        userId: (req.user as { id?: string } | undefined)?.id,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  // Health endpoints (unversioned).
  app.use(healthRouter);

  // Versioned API.
  app.use("/api/v1", v1Router);

  // Error handler last.
  app.use(errorMiddleware);

  return app;
}
