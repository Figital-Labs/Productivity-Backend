import { z } from "zod";

import { dateStringSchema } from "./common.js";

/**
 * Body fields for `POST /day-closure/submit`. Audio comes via multipart
 * (`req.file`), not in the body. `mediaIds` is intentionally NOT accepted in
 * Sprint 7 — task media + S3 storage land in a future sprint; the column
 * stays `String[]` defaulting to `[]`.
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
