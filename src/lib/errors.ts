/**
 * AppError is the base for any error that maps to a known HTTP response.
 * Anything thrown that's not an AppError is treated as a 500 by the central
 * error middleware (and full details are console.error'd server-side).
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", 403, message);
  }
}

/**
 * Use as: `throw new NotFoundError("Task", id)` → 404 with code `TASK_NOT_FOUND`.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      404,
      id !== undefined ? `${resource} with id ${id} not found` : `${resource} not found`,
    );
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 409, message, details);
  }
}

/**
 * Use when a downstream service (Vertex AI, S3, etc.) returned something we
 * can't make sense of — empty body, invalid JSON, schema violation. Maps to 502.
 */
export class UpstreamError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 502, message, details);
  }
}
