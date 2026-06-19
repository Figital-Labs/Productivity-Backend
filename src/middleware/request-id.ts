/**
 * Correlation ID per request. Reuses an inbound `X-Request-Id` (e.g. from a proxy) or mints
 * one, stashes it on `res.locals.requestId`, and echoes it in the response header — so a
 * user-reported error maps straight to its server log line.
 */
import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id =
    incoming !== undefined && incoming.length > 0 && incoming.length <= 200
      ? incoming
      : randomUUID();
  res.locals["requestId"] = id;
  res.setHeader("X-Request-Id", id);
  next();
}

/** Read the correlation id back out of a response (set by the `requestId` middleware). */
export function getRequestId(res: Response): string | undefined {
  const id: unknown = res.locals["requestId"];
  return typeof id === "string" ? id : undefined;
}
