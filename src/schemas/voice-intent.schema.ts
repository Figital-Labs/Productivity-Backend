import { z } from "zod";

import { priorityEnum } from "./common.js";

/**
 * The output shape Gemini must produce for `POST /voice/process`. This zod
 * schema is used twice:
 *   1. Converted via `z.toJSONSchema(...)` and sent to Vertex as
 *      `responseJsonSchema` — Gemini's decoder constrains output to this shape.
 *   2. Re-parsed on receipt, so if Gemini drifts the response surfaces as a
 *      typed validation error (UpstreamError) rather than runtime corruption.
 *
 * The `reasoning` field is required everywhere so we have an audit trail of
 * *why* Gemini chose each action — useful when actions go wrong.
 */
export const voiceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("created"),
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    priority: priorityEnum.optional(),
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
