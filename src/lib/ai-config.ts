import { env } from "../config/env.js";

/**
 * Per-surface generation config for Gemini 2.5 Flash.
 *
 * Low temperature on the extraction/matching surfaces — determinism is what
 * kills the "the task turned out different" complaint; the same input should
 * produce the same tasks. A little warmth only on the narrative surfaces
 * (day-closure summary, morning brief). Transcription is verbatim → 0.
 *
 * `thinkingBudget` is bounded to cap latency/cost (0 disables thinking, -1 is
 * dynamic). These are sensible starting points — tune against `npm run eval`.
 */
export const AI_TEMPERATURE = {
  extraction: 0.2, // voice / text / image personal capture
  delegation: 0.2, // team voice/text/image delegate
  meeting: 0.2,
  dayClosure: 0.3,
  morningBrief: 0.35,
  transcribe: 0.0,
} as const;

// gemini-2.5-flash thinkingBudget range is 0..24576 (0 = off, -1 = dynamic).
export const AI_THINKING_BUDGET = {
  extraction: 512,
  delegation: 512,
  meeting: 1024,
  dayClosure: 256,
  morningBrief: 256,
  transcribe: 0, // verbatim — no thinking
} as const;

/**
 * Per-attempt request timeout (our `withTimeout`, NOT undici's separate ~10s connect
 * timeout).
 * - `meeting` runs in the async worker. We support the p95 long meeting (up to ~6.5 hr / 90 MB),
 *   so the ceiling is sized for that worst case with generous margin — a 2-hour recording still
 *   measures ~1 min on Flash; this is a safety cap, not the expected time. The pg-boss visibility
 *   timeout AND the frontend poll patience both derive from this (via `jobBudgetSeconds`).
 * - `media` covers the synchronous audio/image capture endpoints — 30s is tight when an
 *   audio call spikes, so give them 60s of headroom (they're still short, just safer).
 */
export const AI_TIMEOUT_MS = {
  default: 30_000,
  media: 60_000, // sync audio/image capture (voice, image, transcribe, team voice/image)
  // Env-tunable (MEETING_AI_TIMEOUT_MS, default 800000 ≈ 13 min) — sized for a ~5–6 hr / 90 MB
  // meeting. Queue expiry + FE poll patience derive from this, so this one knob tunes the chain.
  meeting: env.meetingAiTimeoutMs,
} as const;

export type AiJobKind = keyof typeof AI_TIMEOUT_MS;

/**
 * Total AI attempts that can each consume a FULL `timeoutMs` = `AI_MAX_RETRIES + 1`. Only fast
 * recoverable OUTPUT errors retry (empty/invalid-JSON/schema — see `RECOVERABLE_CODES` in
 * vertex.ts); `AI_TIMEOUT` is intentionally NOT recoverable, so a hung call fails once instead of
 * re-running a 13-min, 90 MB job.
 */
export const AI_MAX_RETRIES = 1;

/**
 * Backoff schedules per failure class, in ms. Array length = number of RETRIES for that class,
 * so `[400]` means one retry after 400 ms (two attempts total). See `classifyAiFailure`.
 *
 *  - `fast`    — the DEFAULT, byte-identical to the historical behaviour. Every SYNCHRONOUS
 *                surface (voice, image, text, transcribe, brief, closure, delegates) uses it:
 *                a user is watching a spinner, so seconds of backoff would be a UX regression
 *                and could collide with nginx's `proxy_read_timeout`.
 *  - `patient` — for queued work only (the meeting worker), where nobody is blocked on the
 *                request. A per-minute Vertex quota window needs tens of seconds, not 400 ms —
 *                that mismatch is why a transient 429 surfaced as a hard failure that then
 *                succeeded on a manual retry.
 *
 * `jobBudgetSeconds` below adds these delays to the queue's visibility window, so a retrying job
 * can never outlive `expireInSeconds` (pg-boss ABORTS the handler at that point and re-dispatches,
 * which would double-process the meeting).
 */
export const RETRY_PROFILES = {
  fast: { output: [400], transient: [400] },
  patient: { output: [400], transient: [2_000, 10_000, 30_000] },
} as const;

export type RetryProfile = keyof typeof RETRY_PROFILES;

/** Which schedule each job kind runs under. Only queued work may be `patient`. */
export const RETRY_PROFILE_FOR: Record<AiJobKind, RetryProfile> = {
  default: "fast",
  media: "fast",
  meeting: "patient",
};

/** Worst-case total time spent sleeping between retries, for one execution. */
function retryBackoffMs(profile: RetryProfile): number {
  const s = RETRY_PROFILES[profile];
  return [...s.output, ...s.transient].reduce((n, ms) => n + ms, 0);
}

/**
 * Per-job overhead beyond the AI call itself: the S3 download of the media + the DB writes that
 * finalize the job. A long meeting can have ~130 small clips to fetch, so it gets more headroom
 * than a single-file capture.
 */
const DOWNLOAD_HEADROOM_MS = {
  default: 60_000,
  media: 120_000,
  meeting: 180_000,
} as const;

/**
 * The worst-case wall-clock budget for ONE worker execution of a job, in seconds — the single
 * source of truth. pg-boss's `expireInSeconds` is set from this so the queue can NEVER treat an
 * in-flight job as stalled, and the frontend's poll patience derives from the same number (served
 * via `GET /config`) so FE and BE can't drift. Sized for the full retry path:
 * `(retries + 1) × per-attempt timeout + download/write overhead`.
 */
export function jobBudgetSeconds(kind: AiJobKind): number {
  const attempts = AI_MAX_RETRIES + 1;
  // Retry SLEEP is real wall-clock inside the handler, so it must be inside the budget too —
  // pg-boss aborts a handler that outlives `expireInSeconds`. Transient attempts themselves
  // return in seconds (the API rejects immediately), so they are absorbed by the headroom below;
  // only the full-timeout OUTPUT path is multiplied by `attempts`.
  const backoffMs = retryBackoffMs(RETRY_PROFILE_FOR[kind]);
  return Math.ceil(
    (attempts * AI_TIMEOUT_MS[kind] + backoffMs + DOWNLOAD_HEADROOM_MS[kind]) / 1000,
  );
}
