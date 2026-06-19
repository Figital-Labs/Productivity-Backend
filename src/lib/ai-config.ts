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
 * - `meeting` runs in the async worker; a 2-hour recording measures ~1 min on Flash, so a
 *   5-min ceiling is generous (the pg-boss visibility timeout is derived from this).
 * - `media` covers the synchronous audio/image capture endpoints — 30s is tight when an
 *   audio call spikes, so give them 60s of headroom (they're still short, just safer).
 */
export const AI_TIMEOUT_MS = {
  default: 30_000,
  media: 60_000, // sync audio/image capture (voice, image, transcribe, team voice/image)
  meeting: 300_000, // 5 min — async worker; real ~1 min for a 2-hour recording
} as const;
