/**
 * Tiny structured logger. One source of truth for backend logs so a failure anywhere in the
 * request/job lifecycle is traceable: every line carries a tag + a context bag (requestId,
 * jobId, meetingId, userId, durationMs, key…). Console-backed today; swap the `write` body
 * for `pino` later without touching call sites.
 *
 * Prod emits single-line JSON (aggregator-friendly); dev emits a readable `[tag] msg k=v` line.
 */
import { env } from "../config/env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  orgId?: string | undefined;
  jobId?: string | undefined;
  meetingId?: string | undefined;
  surface?: string | undefined;
  key?: string | undefined;
  durationMs?: number | undefined;
  [extra: string]: unknown;
}

const isProd = env.nodeEnv === "production";

// Emit at or above LOG_LEVEL (default `info` → routine GET access logs are debug, hence quiet).
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = RANK[env.logLevel];

function format(level: LogLevel, tag: string, message: string, ctx?: LogContext): string {
  if (isProd) {
    return JSON.stringify({ ts: new Date().toISOString(), level, tag, message, ...ctx });
  }
  const parts = Object.entries(ctx ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return `[${tag}] ${message}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`;
}

function write(level: LogLevel, tag: string, message: string, ctx?: LogContext): void {
  if (RANK[level] < THRESHOLD) return;
  const line = format(level, tag, message, ctx);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (tag: string, message: string, ctx?: LogContext): void => {
    write("debug", tag, message, ctx);
  },
  info: (tag: string, message: string, ctx?: LogContext): void => {
    write("info", tag, message, ctx);
  },
  warn: (tag: string, message: string, ctx?: LogContext): void => {
    write("warn", tag, message, ctx);
  },
  error: (tag: string, message: string, ctx?: LogContext): void => {
    write("error", tag, message, ctx);
  },
};

/** Normalize any thrown value to a `{ message, stack }` pair for logging. */
export function errInfo(err: unknown): { message: string; stack?: string | undefined } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}
