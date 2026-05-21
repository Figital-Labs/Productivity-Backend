import type { Request, Response, NextFunction } from "express";

import { AppError } from "../lib/errors.js";

/**
 * Central Express error middleware. Must be registered AFTER all routes.
 * AppError → typed JSON response with the right status code.
 * Anything else → 500 generic; full error logged server-side, never leaked to client.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  // Express requires the 4-arg signature to recognize this as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
    },
  });
}
