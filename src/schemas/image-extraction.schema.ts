import { z } from "zod";

import {
  voiceActionSchema,
  voiceRecommendationSchema,
  type VoiceAction,
  type VoiceRecommendation,
} from "./voice-intent.schema.js";

/**
 * The image flow reuses voice's action + recommendation shapes — both are
 * "AI-extracted intent classification" outputs, modality-neutral despite the
 * `voice*` naming. (Voice was the first surface to define them.) Re-exported
 * with image-specific names so callers don't have a confusing cross-modal
 * import in their code.
 *
 * If image actions diverge from voice in the future (e.g., add page position
 * for OCR'd items), split this file — but don't preempt the abstraction.
 */
export const imageActionSchema = voiceActionSchema;
export type ImageAction = VoiceAction;

export const imageRecommendationSchema = voiceRecommendationSchema;
export type ImageRecommendation = VoiceRecommendation;

/**
 * Input for `POST /images/process`. The image comes via multipart (handled in
 * the controller); this schema covers the form fields. `targetDate` is optional
 * — when present, the AI's TODAY anchor and the dispatcher's default both use it.
 */
export const submitImageInputSchema = z.object({
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD")
    .optional(),
});
export type SubmitImageInput = z.infer<typeof submitImageInputSchema>;

export const imageExtractionResponseSchema = z.object({
  extractedText: z.string(),
  actions: z.array(imageActionSchema),
  recommendations: z.array(imageRecommendationSchema),
});
export type ImageExtractionResponse = z.infer<typeof imageExtractionResponseSchema>;
