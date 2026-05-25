import { z } from "zod";

import { priorityEnum } from "./common.js";

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/**
 * Sprint 11: input for `POST /team/voice/delegate`. Audio comes via multipart
 * (handled in controller); this schema covers form fields. `targetDate`
 * optional — defaults to today.
 */
export const submitTeamVoiceDelegateInputSchema = z.object({
  targetDate: ymdDateSchema.optional(),
});
export type SubmitTeamVoiceDelegateInput = z.infer<typeof submitTeamVoiceDelegateInputSchema>;

/**
 * The delegation endpoint emits only `created` actions — each carries an
 * assigneeId picked from the manager's TEAM DIRECTORY context. Updates to
 * existing delegated tasks go through the personal endpoints (the assignee's
 * own /voice/process matches their task by title) or the UI drill-down.
 */
export const teamDelegateActionSchema = z.object({
  type: z.literal("created"),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
  assigneeId: z.string().min(1),
  reasoning: z.string(),
});
export type TeamDelegateAction = z.infer<typeof teamDelegateActionSchema>;

/**
 * Recommendation shape — identical to voice recommendation. Used when the AI
 * can't confidently pick an assignee (name not in directory, ambiguous name,
 * unnamed item on a photographed list).
 */
export const teamDelegateRecommendationSchema = z.object({
  title: z.string().min(1),
  priority: priorityEnum.optional(),
  targetDate: ymdDateSchema.optional(),
  reasoning: z.string(),
});
export type TeamDelegateRecommendation = z.infer<typeof teamDelegateRecommendationSchema>;

export const teamVoiceDelegateResponseSchema = z.object({
  transcript: z.string(),
  actions: z.array(teamDelegateActionSchema),
  recommendations: z.array(teamDelegateRecommendationSchema),
});
export type TeamVoiceDelegateResponse = z.infer<typeof teamVoiceDelegateResponseSchema>;
