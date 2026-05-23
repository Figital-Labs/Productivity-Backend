import { z } from "zod";

import { voiceActionSchema, voiceRecommendationSchema } from "./voice-intent.schema.js";

/**
 * Input for `POST /api/v1/text/process`. The text is the user's free-form
 * paragraph; the AI extracts intent (created / completed / partial /
 * priority_updated) just like the voice flow does, minus the audio part.
 *
 * `targetDate` is optional — when present, both the AI prompt's TODAY value
 * and the dispatcher's default target date use it. Sprint 8 addition for
 * BUG-002: lets the frontend pass the user's selected `viewDate`.
 */
export const submitTextInputSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD")
    .optional(),
});
export type SubmitTextInput = z.infer<typeof submitTextInputSchema>;

/**
 * AI output shape for `/text/process`. Same actions + recommendations as
 * voice, but with no `transcript` — the input IS the text. Used as Vertex's
 * `responseJsonSchema` AND for post-call validation (UpstreamError contract).
 */
export const textIntentResponseSchema = z.object({
  actions: z.array(voiceActionSchema),
  recommendations: z.array(voiceRecommendationSchema),
});
export type TextIntentResponse = z.infer<typeof textIntentResponseSchema>;
