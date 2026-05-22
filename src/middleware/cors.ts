import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";

const ALLOWED_METHODS = "GET,POST,PATCH,DELETE,OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type,Authorization,Idempotency-Key";

function allowedOriginFor(origin: string | undefined): string | null {
  if (!origin) return null;
  if (env.corsOrigins.includes("*")) return "*";
  return env.corsOrigins.includes(origin) ? origin : null;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const allowedOrigin = allowedOriginFor(req.headers.origin);

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (!allowedOrigin) {
      res.sendStatus(403);
      return;
    }

    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] ?? DEFAULT_ALLOWED_HEADERS,
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
    return;
  }

  next();
}
