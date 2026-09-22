/**
 * Langfuse tracing bootstrap (Figital Labs Langfuse contract v1).
 *
 * The OpenTelemetry SDK is started here at module load, so this module MUST be the very first
 * import of every process entrypoint (src/index.ts, src/worker.ts) — otherwise spans created
 * before it loads go nowhere.
 *
 * Tracing is a no-op when LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are absent: the SDK is never
 * started and every observation falls through to the OpenTelemetry no-op tracer, so local dev
 * keeps working unchanged.
 *
 * Env vars (read by the Langfuse span processor itself):
 *   LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
 *   LANGFUSE_TRACING_ENVIRONMENT (production | staging | development)
 *
 * Model calls themselves are instrumented in `src/lib/vertex.ts` (one generation per attempt);
 * request/job boundaries open a trace with `withTrace` so userId / sessionId / feature are
 * stamped on every generation underneath.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import type { LangfuseSpan } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { config as loadEnv } from "dotenv";

// Same semantics as src/config/env.ts (`override: true` so `.env` wins over a stale shell var);
// this module runs first, so it has to load the file itself before reading the keys. `quiet`
// only suppresses dotenv's duplicate "injected env" banner — env.ts still logs its own.
loadEnv({ override: true, quiet: true });

export const langfuseEnabled = Boolean(
  process.env["LANGFUSE_PUBLIC_KEY"] && process.env["LANGFUSE_SECRET_KEY"],
);

const sdk = langfuseEnabled ? new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] }) : null;
sdk?.start();

let shutdownPromise: Promise<void> | null = null;

/** Flush buffered spans and stop the SDK. Safe to call more than once. */
export function shutdownLangfuse(): Promise<void> {
  shutdownPromise ??= (async () => {
    try {
      await sdk?.shutdown();
    } catch (e: unknown) {
      console.error("langfuse shutdown", e);
    }
  })();
  return shutdownPromise;
}
process.once("SIGTERM", () => {
  void shutdownLangfuse();
});
process.once("SIGINT", () => {
  void shutdownLangfuse();
});

/** `metadata.product` for every trace emitted by this repo (AI use-case tagging standard). */
export const LANGFUSE_PRODUCT = "day-planner";

interface UsageMetadataLike {
  promptTokenCount?: number | undefined;
  candidatesTokenCount?: number | undefined;
  thoughtsTokenCount?: number | undefined;
  cachedContentTokenCount?: number | undefined;
  totalTokenCount?: number | undefined;
}

/**
 * Token usage in the shape Langfuse expects, derived from `response.usageMetadata`. Zero/undefined
 * keys are omitted. Cost is NOT set here — Langfuse computes it from its model price table.
 *
 * Only `input` / `output` / `output_reasoning` / `input_cached` are emitted — Langfuse's cost
 * engine prices exactly those keys. A `total` key (or `promptTokens`/`completionTokens`) is not
 * priced at all and silently shows as zero cost, so it must never be added here.
 */
export function usageFromResponse(res: {
  usageMetadata?: UsageMetadataLike | undefined;
}): Record<string, number> {
  const u = res.usageMetadata ?? {};
  const out: Record<string, number> = {};
  if (u.promptTokenCount) out["input"] = u.promptTokenCount;
  if (u.candidatesTokenCount) out["output"] = u.candidatesTokenCount;
  if (u.thoughtsTokenCount) out["output_reasoning"] = u.thoughtsTokenCount;
  if (u.cachedContentTokenCount) out["input_cached"] = u.cachedContentTokenCount;
  return out;
}

/** "gemini-2.5-flash-preview-05-20" → "gemini-2.5-flash" (model-family tag, contract §4). */
export function modelFamily(model: string): string {
  return model.replace(/-(preview|latest|exp)(-.*)?$/, "").replace(/-\d{3}$/, "");
}

export interface TraceOptions {
  /** The use case, e.g. "meeting-intent" — this is also the trace name. Never contains ids. */
  name: string;
  /** `metadata.feature`; defaults to `name` (the use case, verbatim). */
  feature?: string;
  /** `metadata.service` — the module slug, e.g. "meeting-ai", "team-delegation". */
  service: string;
  /** End-user id the work is done for. */
  userId?: string;
  /** Meeting id, interaction id, job id, ... when one exists. */
  sessionId?: string;
  /** Model id, used for the model-family tag. */
  model?: string;
  /** Small, structured trace input (never raw audio / images). */
  input?: unknown;
  metadata?: Record<string, string>;
}

/**
 * One trace = one unit of user-visible work (one request that calls the model, one queued job).
 * Runs `fn` inside an active root span named `opts.name`, with userId / sessionId / tags /
 * metadata propagated to every child observation. Errors are recorded on the trace and rethrown.
 */
export function withTrace<T>(
  opts: TraceOptions,
  fn: (trace: LangfuseSpan) => Promise<T>,
): Promise<T> {
  const feature = opts.feature ?? opts.name;
  const tags = [LANGFUSE_PRODUCT, opts.service, feature];
  if (opts.model !== undefined) tags.push(modelFamily(opts.model));
  const metadata: Record<string, string> = {
    product: LANGFUSE_PRODUCT,
    service: opts.service,
    feature,
    ...opts.metadata,
  };

  return propagateAttributes(
    {
      ...(opts.userId !== undefined && { userId: opts.userId }),
      ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
      tags,
      metadata,
    },
    () =>
      startActiveObservation(
        opts.name,
        async (trace) => {
          trace.update({ input: opts.input, metadata });
          try {
            return await fn(trace);
          } catch (error: unknown) {
            trace.update({
              level: "ERROR",
              statusMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        { asType: "span" },
      ),
  );
}
