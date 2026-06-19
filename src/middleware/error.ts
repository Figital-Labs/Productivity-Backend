import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { ZodError, treeifyError } from "zod";

import { AppError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";

import { getRequestId } from "./request-id.js";

/**
 * Log the error server-side BEFORE responding — 4xx as `warn`, 5xx as `error` with a stack.
 * Every line carries the requestId + route + userId so a client-reported failure is findable.
 * Previously only unknown 500s were logged, so `AppError`/`ZodError` failures were invisible.
 */
function logError(err: unknown, req: Request, res: Response, status: number, code: string): void {
  const ctx = {
    requestId: getRequestId(res),
    userId: (req.user as { id?: string } | undefined)?.id,
    method: req.method,
    path: req.originalUrl,
    code,
    status,
  };
  if (status >= 500) {
    const { message, stack } = errInfo(err);
    log.error("http", `${code}: ${message}`, { ...ctx, stack });
  } else {
    log.warn("http", code, ctx);
  }
}

/**
 * Central Express error middleware. Must be registered AFTER all routes.
 * AppError → typed JSON response with the right status code.
 * Anything else → 500 generic; full error logged server-side, never leaked to client.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // Express requires the 4-arg signature to recognize this as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logError(err, req, res, err.statusCode, err.code);
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
    logError(err, req, res, 400, "VALIDATION_ERROR");
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
      logError(err, req, res, 413, "FILE_TOO_LARGE");
      res.status(413).json({
        error: {
          code: "FILE_TOO_LARGE",
          message: "Uploaded file exceeds the 10 MB limit.",
          ...(err.field !== undefined ? { details: { field: err.field } } : {}),
        },
      });
      return;
    }
    logError(err, req, res, 400, err.code);
    res.status(400).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.field !== undefined ? { details: { field: err.field } } : {}),
      },
    });
    return;
  }

  logError(err, req, res, 500, "INTERNAL_ERROR");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
    },
  });
}
