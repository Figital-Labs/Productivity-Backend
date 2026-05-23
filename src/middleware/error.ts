import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { ZodError, treeifyError } from "zod";

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

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: treeifyError(err) as Record<string, unknown>,
      },
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      // Stable error code + clearer message for the frontend (BUG-009). The
      // 10 MB cap matches the frontend file-pick guard in TaskSheetImportModal
      // and the duration cap in useAudioRecorder.
      res.status(413).json({
        error: {
          code: "FILE_TOO_LARGE",
          message: "Uploaded file exceeds the 10 MB limit.",
          ...(err.field !== undefined ? { details: { field: err.field } } : {}),
        },
      });
      return;
    }
    res.status(400).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.field !== undefined ? { details: { field: err.field } } : {}),
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
