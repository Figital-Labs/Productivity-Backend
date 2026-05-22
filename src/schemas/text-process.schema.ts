import { z } from "zod";

import { voiceActionSchema, voiceRecommendationSchema } from "./voice-intent.schema.js";

/**
 * Input for `POST /api/v1/text/process`. The text is the user's free-form
 * paragraph; the AI extracts intent (created / completed / partial /
 * priority_updated) just like the voice flow does, minus the audio part.
 */
export const submitTextInputSchema = z.object({
  text: z.string().trim().min(1).max(5000),
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
