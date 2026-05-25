import { z } from "zod";

import {
  teamDelegateActionSchema,
  teamDelegateRecommendationSchema,
} from "./team-voice-delegate.schema.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/**
 * Sprint 11: input for `POST /team/text/delegate`. Body carries the typed
 * paragraph + optional targetDate anchor.
 */
export const submitTeamTextDelegateInputSchema = z.object({
  text: z.string().min(1, "text is required").max(5000),
  targetDate: ymdDateSchema.optional(),
});
export type SubmitTeamTextDelegateInput = z.infer<typeof submitTeamTextDelegateInputSchema>;

/**
 * Response: no transcript (the input is the text). Actions + recommendations
 * reuse the same shapes as voice delegation.
 */
export const teamTextDelegateResponseSchema = z.object({
  actions: z.array(teamDelegateActionSchema),
  recommendations: z.array(teamDelegateRecommendationSchema),
});
export type TeamTextDelegateResponse = z.infer<typeof teamTextDelegateResponseSchema>;
