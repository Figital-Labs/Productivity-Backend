import { GoogleGenAI, MediaModality } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";
import { z } from "zod";

import { env } from "../config/env.js";

import { AI_MAX_RETRIES } from "./ai-config.js";
import { UpstreamError } from "./errors.js";
import { log } from "./logger.js";

/**
 * Single GoogleGenAI client for the lifetime of the process. Constructed with
 * Vertex AI credentials parsed at boot in `src/config/env.ts`. Reuse this
 * instance across every Vertex call — the SDK manages its own request pool.
 */
const ai = new GoogleGenAI({
  vertexai: true,
  project: env.gcp.project,
  location: env.gcp.location,
  googleAuthOptions: { credentials: env.gcp.credentials },
});

export const GEMINI_FLASH_MODEL = "gemini-2.5-flash";

export interface InlineMedia {
  mimeType: string;
  buffer: Buffer;
}

/**
 * Knobs shared by the structured + text helpers. All optional — when a caller
 * passes none of them, the request is byte-identical to the pre-resilience
 * behaviour (every field is conditionally spread into the config).
 */
interface CommonGenOptions {
  temperature?: number;
  systemInstruction?: string;
  thinkingBudget?: number;
  /** Total attempts = maxRetries + 1. Default 1 (→ 2 attempts). */
  maxRetries?: number;
  /** Per-attempt timeout. Default 30000ms. */
  timeoutMs?: number;
  /** Called with the raw model text BEFORE parsing — for logging/persistence. */
  onRaw?: (raw: string) => void;
  /** Surface label for logs (e.g. "meeting", "voice") — pure observability. */
  label?: string;
}

export interface GenerateStructuredOptions<S extends z.ZodType> extends CommonGenOptions {
  model: string;
  prompt: string;
  schema: S;
  media?: InlineMedia[];
}

export interface GenerateTextOptions extends CommonGenOptions {
  model: string;
  prompt: string;
  media?: InlineMedia[];
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const DEFAULT_TIMEOUT_MS = 30_000;
// Single source of truth (ai-config) so the queue's visibility budget — which assumes this many
// attempts — never disagrees with what the AI layer actually does.
const DEFAULT_MAX_RETRIES = AI_MAX_RETRIES;

/**
 * UpstreamError codes worth retrying — transient model/OUTPUT failures (they fail fast). Auth,
 * quota and bad-request errors are NOT in here (retrying them is pointless). `AI_TIMEOUT` is also
 * deliberately excluded: re-running a hung call rarely helps and, for a 90 MB meeting, would double
 * the wall-clock/memory/cost. A timeout fails the attempt once; pg-boss `retryLimit` handles a
 * genuinely crashed worker as a separate, fresh dispatch.
 */
const RECOVERABLE_CODES = new Set(["AI_EMPTY_RESPONSE", "AI_INVALID_JSON", "AI_SCHEMA_MISMATCH"]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `[ai-meta]` — finishReason + token usage (incl. audio tokens) for cost/latency tracing. */
function logMeta(
  surface: string,
  response: GenerateContentResponse,
  durationMs: number,
  outputLen: number,
): void {
  const usage = response.usageMetadata;
  const audioTokens = usage?.promptTokensDetails?.find(
    (d) => d.modality === MediaModality.AUDIO,
  )?.tokenCount;
  log.info("ai", "done", {
    surface,
    durationMs,
    finishReason: response.candidates?.[0]?.finishReason ?? "?",
    promptTokens: usage?.promptTokenCount,
    candidateTokens: usage?.candidatesTokenCount,
    audioTokens,
    outputLen,
  });
}

/** Total inline media bytes — flags how heavy the request body is. */
function mediaBytes(media?: InlineMedia[]): number {
  return (media ?? []).reduce((n, m) => n + m.buffer.length, 0);
}

function buildParts(prompt: string, media?: InlineMedia[]): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const m of media ?? []) {
    parts.push({ inlineData: { mimeType: m.mimeType, data: m.buffer.toString("base64") } });
  }
  return parts;
}

function buildConfig(
  opts: CommonGenOptions,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(opts.systemInstruction !== undefined && { systemInstruction: opts.systemInstruction }),
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.thinkingBudget !== undefined && {
      thinkingConfig: { thinkingBudget: opts.thinkingBudget },
    }),
    ...extra,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new UpstreamError("AI_TIMEOUT", `Vertex call exceeded ${ms.toString()}ms.`));
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry on recoverable UpstreamError codes, or on unknown/network errors
 * (SDK transport failures, 5xx). Backoff is quadratic: 400ms, 1600ms, ...
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const recoverable = !(err instanceof UpstreamError) || RECOVERABLE_CODES.has(err.code);
      if (!recoverable || attempt === maxRetries) throw err;
      await sleep(400 * (attempt + 1) ** 2);
    }
  }
  throw lastErr;
}

/**
 * One-shot multimodal generation with structured output.
 *
 * The zod schema is converted to JSON Schema and sent to Gemini as
 * `responseJsonSchema` (SDK ≥1.9.0), which constrains the model's output shape
 * at decode time. We then re-parse the response with the same zod schema so the
 * value type is exact at the call site and any drift between Gemini and the
 * schema surfaces as an `UpstreamError`, not silent type drift.
 *
 * Wrapped in retry (recoverable output failures) + per-attempt timeout.
 */
export async function generateStructured<S extends z.ZodType>(
  opts: GenerateStructuredOptions<S>,
): Promise<z.infer<S>> {
  const parts = buildParts(opts.prompt, opts.media);
  const config = buildConfig(opts, {
    responseMimeType: "application/json",
    responseJsonSchema: z.toJSONSchema(opts.schema),
  });
  const surface = opts.label ?? "structured";
  log.debug("ai", "request", {
    surface,
    model: opts.model,
    clips: opts.media?.length ?? 0,
    bytes: mediaBytes(opts.media),
  });

  return withRetry(async () => {
    const startedAt = Date.now();
    const response = await withTimeout(
      ai.models.generateContent({ model: opts.model, contents: [{ role: "user", parts }], config }),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      log.warn("ai", "empty response", { surface });
      throw new UpstreamError("AI_EMPTY_RESPONSE", "Vertex returned no text content.");
    }
    opts.onRaw?.(text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      log.warn("ai", "invalid JSON", { surface, rawLen: text.length });
      throw new UpstreamError("AI_INVALID_JSON", "Vertex response was not valid JSON.", {
        raw: text,
      });
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      log.warn("ai", "schema mismatch", {
        surface,
        rawLen: text.length,
        issues: result.error.issues.length,
      });
      throw new UpstreamError("AI_SCHEMA_MISMATCH", "Vertex response did not match the schema.", {
        raw: text,
        issues: result.error.issues as unknown as Record<string, unknown>,
      });
    }
    logMeta(surface, response, Date.now() - startedAt, text.length);
    return result.data;
  }, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
}

/**
 * Sprint 17 — plain-text generation. Mirrors `generateStructured` but without
 * `responseJsonSchema`, so the model returns free-form text. Used today by
 * `POST /transcribe` for verbatim audio→text. Throws
 * `UpstreamError("AI_EMPTY_RESPONSE")` on empty output.
 */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const parts = buildParts(opts.prompt, opts.media);
  const config = buildConfig(opts, {});
  const surface = opts.label ?? "text";
  log.debug("ai", "request", { surface, model: opts.model, bytes: mediaBytes(opts.media) });

  return withRetry(async () => {
    const startedAt = Date.now();
    const response = await withTimeout(
      ai.models.generateContent({
        model: opts.model,
        contents: [{ role: "user", parts }],
        ...(Object.keys(config).length > 0 && { config }),
      }),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const text = response.text;
    if (typeof text !== "string" || text.length === 0) {
      log.warn("ai", "empty response", { surface });
      throw new UpstreamError("AI_EMPTY_RESPONSE", "Vertex returned no text content.");
    }
    opts.onRaw?.(text);
    logMeta(surface, response, Date.now() - startedAt, text.length);
    return text;
  }, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
}
