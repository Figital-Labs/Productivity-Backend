import { z } from "zod";

import {
  teamDelegateActionSchema,
  teamDelegateRecommendationSchema,
} from "./team-voice-delegate.schema.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/**
 * Sprint 11: input for `POST /team/image/delegate`. Image comes via multipart;
 * this schema covers form fields.
 */
export const submitTeamImageDelegateInputSchema = z.object({
  targetDate: ymdDateSchema.optional(),
});
export type SubmitTeamImageDelegateInput = z.infer<typeof submitTeamImageDelegateInputSchema>;

/**
 * Response shape mirrors image-extraction's: `extractedText` instead of
 * `transcript`. Actions + recommendations reuse the team delegation shapes.
 */
export const teamImageDelegateResponseSchema = z.object({
  extractedText: z.string(),
  actions: z.array(teamDelegateActionSchema),
  recommendations: z.array(teamDelegateRecommendationSchema),
});
export type TeamImageDelegateResponse = z.infer<typeof teamImageDelegateResponseSchema>;
