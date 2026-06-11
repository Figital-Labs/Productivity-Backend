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
 * Per-attempt request timeout (our `withTimeout`, NOT undici's separate ~10s
 * connect timeout). Meetings are the heaviest call (multi-clip audio + images);
 * for this MVP we keep them synchronous and just give them a generous ceiling
 * rather than building async job processing. (Deploy caveat: a multi-minute
 * synchronous request can hit platform/proxy timeouts in prod — async then.)
 */
export const AI_TIMEOUT_MS = {
  default: 30_000,
  meeting: 1_200_000, // 20 min
} as const;
