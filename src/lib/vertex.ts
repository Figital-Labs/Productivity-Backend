import { GoogleGenAI, MediaModality } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";
import { getActiveTraceId, startObservation } from "@langfuse/tracing";
import type { LangfuseGeneration } from "@langfuse/tracing";
import { z } from "zod";

import { env } from "../config/env.js";

import {
  RETRY_PROFILES,
  type RetryProfile,
  thinkingLevelForBudget,
  usesThinkingLevel,
} from "./ai-config.js";
import { UpstreamError } from "./errors.js";
import { usageFromResponse, withTrace } from "./langfuse.js";
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

/**
 * The model is no longer a constant — `gemini-2.5-flash` retires on Vertex AI in
 * October 2026. Call sites resolve it per surface via `modelFor()` in ai-config,
 * which reads `GEMINI_MODEL` / `GEMINI_MODEL_<SURFACE>` from the environment.
 */

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
  /**
   * `| undefined` is explicit because `temperatureFor()` returns undefined under
   * AI_TEMPERATURE_MODE=model-default, and the repo runs `exactOptionalPropertyTypes`.
   * Undefined means "omit it" — the model then applies its own default.
   */
  temperature?: number | undefined;
  systemInstruction?: string;
  thinkingBudget?: number;
  /**
   * Retry schedule. Default "fast" — identical to the historical behaviour, and correct for every
   * SYNCHRONOUS caller. Only async/queued work (the meeting worker) should pass "patient", and
   * doing so REQUIRES `jobBudgetSeconds` to cover the extra backoff (see ai-config.ts).
   */
  retryProfile?: RetryProfile;
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

/**
 * UpstreamError codes worth retrying — transient model/OUTPUT failures (they fail fast). Auth,
 * quota and bad-request errors are NOT in here (retrying them is pointless). `AI_TIMEOUT` is also
 * deliberately excluded: re-running a hung call rarely helps and, for a 90 MB meeting, would double
 * the wall-clock/memory/cost. A timeout fails the attempt once; pg-boss `retryLimit` handles a
 * genuinely crashed worker as a separate, fresh dispatch.
 */
const RECOVERABLE_CODES = new Set(["AI_EMPTY_RESPONSE", "AI_INVALID_JSON", "AI_SCHEMA_MISMATCH"]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How a failed attempt should be treated. Previously this was a single boolean —
 * `!(err instanceof UpstreamError)` — which was wrong at BOTH ends: a permanent 401/400 from the
 * SDK was retried (burning a second full `timeoutMs`; up to ~27 min on a meeting), while a
 * transient 429/503 got only the same 400 ms backoff as a fast output error, which is far too
 * short for a per-minute quota window.
 *
 *  - `output`    — the model replied but the payload was unusable. Fails fast, retry immediately.
 *  - `transient` — infrastructure said "try later" (429/503/5xx, socket drop). Needs REAL backoff.
 *  - `permanent` — nothing will change on a retry (auth, bad request, our own AI_TIMEOUT).
 */
export type AiFailureClass = "output" | "transient" | "permanent";

/** Best-effort HTTP status extraction across SDK error shapes (and, last resort, the message). */
function httpStatusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  for (const v of [e.status, e.statusCode, e.code]) {
    if (typeof v === "number" && v >= 100 && v < 600) return v;
    if (typeof v === "string" && /^\d{3}$/.test(v)) return Number(v);
  }
  // The @google/genai SDK often only carries the status inside the message text.
  if (typeof e.message === "string") {
    const m = /\b(4\d{2}|5\d{2})\b/.exec(e.message);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

export function classifyAiFailure(err: unknown): AiFailureClass {
  if (err instanceof UpstreamError) {
    // Unchanged: output errors retry, everything else (incl. AI_TIMEOUT) is terminal.
    return RECOVERABLE_CODES.has(err.code) ? "output" : "permanent";
  }
  const status = httpStatusOf(err);
  if (status !== undefined) {
    // 408 request timeout, 429 quota, 5xx capacity → worth waiting for.
    if (status === 408 || status === 429 || status >= 500) return "transient";
    // 400/401/403/404 — a retry produces the identical failure, just slower.
    return "permanent";
  }
  // No status at all: transport-level (ECONNRESET, socket hang up, DNS). Genuinely transient.
  return "transient";
}

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

/**
 * Thinking config in the shape the target model accepts: Gemini 3+ takes the
 * `thinkingLevel` enum, 2.x takes the numeric `thinkingBudget`, and sending both
 * is an API error. Callers keep passing a budget; the translation happens here so
 * switching models (or rolling back) is an env change, not a code change.
 */
function thinkingConfigFor(model: string, budget: number): Record<string, unknown> {
  return usesThinkingLevel(model)
    ? { thinkingLevel: thinkingLevelForBudget(budget) }
    : { thinkingBudget: budget };
}

function buildConfig(
  model: string,
  opts: CommonGenOptions,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(opts.systemInstruction !== undefined && { systemInstruction: opts.systemInstruction }),
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.thinkingBudget !== undefined && {
      thinkingConfig: thinkingConfigFor(model, opts.thinkingBudget),
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
 * Retry with a per-failure-class budget (see `classifyAiFailure` / `RETRY_PROFILES`).
 *
 * Output and transient failures are counted SEPARATELY, so a run that hits one 429 still has its
 * full output-retry allowance left (and vice versa). Permanent failures abort immediately rather
 * than burning another `timeoutMs`.
 */
async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  profile: RetryProfile,
  surface: string,
): Promise<T> {
  const schedule = RETRY_PROFILES[profile];
  let outputRetries = 0;
  let transientRetries = 0;

  for (;;) {
    try {
      return await fn(outputRetries + transientRetries + 1);
    } catch (err) {
      const kind = classifyAiFailure(err);
      if (kind === "permanent") throw err;

      const delays = schedule[kind];
      const used = kind === "output" ? outputRetries : transientRetries;
      if (used >= delays.length) throw err;
      if (kind === "output") outputRetries += 1;
      else transientRetries += 1;

      const delayMs = delays[used] ?? 0;
      log.warn("ai", "retrying", {
        surface,
        kind,
        attempt: used + 1,
        of: delays.length,
        delayMs,
        message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      await sleep(delayMs);
    }
  }
}

/** Loggable copy of the request parts — inline media becomes `{ mimeType, bytes }`, never the payload. */
function partsForTrace(parts: GeminiPart[]): unknown[] {
  return parts.map((p) =>
    "inlineData" in p
      ? {
          inlineData: {
            mimeType: p.inlineData.mimeType,
            bytes: Math.floor((p.inlineData.data.length * 3) / 4),
          },
        }
      : p,
  );
}

function modelParametersFor(
  opts: CommonGenOptions,
  config: Record<string, unknown>,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (opts.temperature !== undefined) params["temperature"] = opts.temperature;
  if (opts.thinkingBudget !== undefined) params["thinkingBudget"] = opts.thinkingBudget;
  const mime = config["responseMimeType"];
  if (typeof mime === "string") params["responseMimeType"] = mime;
  return params;
}

/**
 * Langfuse: one `generation` observation per attempt (retries are separate generations under the
 * same trace), nested under whatever trace is active — see `underTrace`.
 */
function startGeneration(
  surface: string,
  opts: CommonGenOptions & { model: string },
  parts: GeminiPart[],
  config: Record<string, unknown>,
  attempt: number,
): LangfuseGeneration {
  return startObservation(
    opts.model,
    {
      model: opts.model,
      input: {
        ...(opts.systemInstruction !== undefined && { systemInstruction: opts.systemInstruction }),
        contents: [{ role: "user", parts: partsForTrace(parts) }],
      },
      modelParameters: modelParametersFor(opts, config),
      metadata: { surface, attempt, retryProfile: opts.retryProfile ?? "fast" },
    },
    { asType: "generation" },
  );
}

/** Record output + usage (when the model answered) and ERROR + message (when the attempt threw). */
function endGeneration(
  generation: LangfuseGeneration,
  response: GenerateContentResponse | undefined,
  failure: { error: unknown } | undefined,
): void {
  generation
    .update({
      ...(response !== undefined && {
        output: response.text ?? "",
        usageDetails: usageFromResponse(response),
      }),
      ...(failure !== undefined && {
        level: "ERROR" as const,
        statusMessage:
          failure.error instanceof Error ? failure.error.message : String(failure.error),
      }),
    })
    .end();
}

/**
 * Run `fn` under the caller's active Langfuse trace when one exists (the request/job boundary
 * opens it with userId / sessionId / feature via `withTrace`), otherwise open a trace named after
 * the surface label so every caller is covered. This is a defensive fallback only — every current
 * call site already opens its own trace with the correct use-case name/service before calling in,
 * so `service` here is just the surface label rather than a real module slug.
 */
function underTrace<T>(surface: string, model: string, fn: () => Promise<T>): Promise<T> {
  if (getActiveTraceId() !== undefined) return fn();
  return withTrace({ name: surface, feature: surface, service: surface, model }, fn);
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
  const config = buildConfig(opts.model, opts, {
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

  return underTrace(surface, opts.model, () =>
    withRetry(
      async (attempt) => {
        const generation = startGeneration(surface, opts, parts, config, attempt);
        let response: GenerateContentResponse | undefined;
        let failure: { error: unknown } | undefined;
        try {
          const startedAt = Date.now();
          response = await withTimeout(
            ai.models.generateContent({
              model: opts.model,
              contents: [{ role: "user", parts }],
              config,
            }),
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
            throw new UpstreamError(
              "AI_SCHEMA_MISMATCH",
              "Vertex response did not match the schema.",
              {
                raw: text,
                issues: result.error.issues as unknown as Record<string, unknown>,
              },
            );
          }
          logMeta(surface, response, Date.now() - startedAt, text.length);
          return result.data;
        } catch (err) {
          failure = { error: err };
          throw err;
        } finally {
          endGeneration(generation, response, failure);
        }
      },
      opts.retryProfile ?? "fast",
      surface,
    ),
  );
}

/**
 * Sprint 17 — plain-text generation. Mirrors `generateStructured` but without
 * `responseJsonSchema`, so the model returns free-form text. Used today by
 * `POST /transcribe` for verbatim audio→text. Throws
 * `UpstreamError("AI_EMPTY_RESPONSE")` on empty output.
 */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const parts = buildParts(opts.prompt, opts.media);
  const config = buildConfig(opts.model, opts, {});
  const surface = opts.label ?? "text";
  log.debug("ai", "request", { surface, model: opts.model, bytes: mediaBytes(opts.media) });

  return underTrace(surface, opts.model, () =>
    withRetry(
      async (attempt) => {
        const generation = startGeneration(surface, opts, parts, config, attempt);
        let response: GenerateContentResponse | undefined;
        let failure: { error: unknown } | undefined;
        try {
          const startedAt = Date.now();
          response = await withTimeout(
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
        } catch (err) {
          failure = { error: err };
          throw err;
        } finally {
          endGeneration(generation, response, failure);
        }
      },
      opts.retryProfile ?? "fast",
      surface,
    ),
  );
}
