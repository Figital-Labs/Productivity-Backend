import { z } from "zod";

import { dateStringSchema } from "./common.js";

/**
 * Body fields for `POST /day-closure/review` (Sprint 17). The review phase
 * generates AI feedback once and persists a `status='draft'` row. No
 * commentary, no audio — both belong to the final submit.
 */
export const reviewDayClosureInputSchema = z.object({
  date: dateStringSchema.optional(),
  commentary: z.string().max(5000).optional(),
});
export type ReviewDayClosureInput = z.infer<typeof reviewDayClosureInputSchema>;

/**
 * Body fields for `POST /day-closure/submit` (Sprint 17 rewrite). The submit
 * phase requires a prior draft from review and finalizes it. Audio is gone
 * from this endpoint — closure voice is excuse commentary only and is
 * transcribed to text via `POST /transcribe` before being sent here.
 * `mediaIds` is still not accepted (S3 storage deferred).
 */
export const submitDayClosureInputSchema = z.object({
  commentary: z.string().max(5000).optional(),
  date: dateStringSchema.optional(),
});
export type SubmitDayClosureInput = z.infer<typeof submitDayClosureInputSchema>;

export const getDayClosureQuerySchema = z
  .object({
    date: dateStringSchema.optional(),
    unreviewed: z.enum(["true"]).optional(),
  })
  .refine((query) => query.unreviewed === "true" || query.date !== undefined, {
    message: "`date` is required unless `unreviewed=true`",
    path: ["date"],
  });
export type GetDayClosureQuery = z.infer<typeof getDayClosureQuerySchema>;
