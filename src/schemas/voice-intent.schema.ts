import { z } from "zod";

import { priorityEnum } from "./common.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/**
 * Input for `POST /voice/process`. Audio comes via multipart (handled in the
 * controller); this schema covers the form fields. `targetDate` is optional —
 * when present, both the AI prompt's TODAY value and the dispatcher's default
 * target date use it. When absent, both fall back to `todayInUserTz`.
 */
export const submitVoiceInputSchema = z.object({
  targetDate: ymdDateSchema.optional(),
});
export type SubmitVoiceInput = z.infer<typeof submitVoiceInputSchema>;

/**
 * The output shape Gemini must produce for `POST /voice/process`. This zod
 * schema is used twice:
 *   1. Converted via `z.toJSONSchema(...)` and sent to Vertex as
 *      `responseJsonSchema` — Gemini's decoder constrains output to this shape.
 *   2. Re-parsed on receipt, so if Gemini drifts the response surfaces as a
 *      typed validation error (UpstreamError) rather than runtime corruption.
 *
 * The `reasoning` field is required everywhere — and as of Sprint 8 it's
 * user-facing (rendered in the recommendation card), so the prompt enforces
 * brief / native-language / P.A.-tone phrasing. See [BUG-003](../../../Task-List/.agents/BUGS.md).
 *
 * `created` actions carry an optional `targetDate` — when the user mentioned a
 * relative date phrase ("kal", "Friday", "next Monday"), the AI resolves it
 * against the prompt's TODAY anchor and emits it here. The dispatcher uses it
 * verbatim; absent → falls back to the request's effective `today`.
 */
export const voiceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("created"),
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    priority: priorityEnum.optional(),
    targetDate: ymdDateSchema.optional(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("priority_updated"),
    taskId: z.string().min(1),
    priority: priorityEnum,
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("completed"),
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("partial"),
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
]);
export type VoiceAction = z.infer<typeof voiceActionSchema>;

export const voiceRecommendationSchema = z.object({
  title: z.string().min(1),
  priority: priorityEnum.optional(),
  completed: z.boolean().optional(),
  reasoning: z.string(),
});
export type VoiceRecommendation = z.infer<typeof voiceRecommendationSchema>;

export const voiceIntentResponseSchema = z.object({
  transcript: z.string(),
  actions: z.array(voiceActionSchema),
  recommendations: z.array(voiceRecommendationSchema),
});
export type VoiceIntentResponse = z.infer<typeof voiceIntentResponseSchema>;
