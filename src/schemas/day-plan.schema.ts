import { z } from "zod";

import { dateStringSchema } from "./common.js";

export const submitDayPlanInputSchema = z.object({
  date: dateStringSchema.optional(),
});
export type SubmitDayPlanInput = z.infer<typeof submitDayPlanInputSchema>;

export const getDayPlanQuerySchema = z.object({
  date: dateStringSchema,
});
export type GetDayPlanQuery = z.infer<typeof getDayPlanQuerySchema>;

/**
 * The minimal shape we snapshot into `DayPlanSubmission.taskSnapshot`. Strip
 * audit fields (sourceType/sourceId/createdAt/updatedAt) — closure only needs
 * the identity + status + priority + notes for the plan-vs-reality comparison.
 * targetDate is included as a YYYY-MM-DD string for JSON friendliness.
 */
// Must be a `type` (not `interface`) so it satisfies Prisma's `InputJsonObject`
// index signature when passed to a Json column. Interfaces are open in TS and
// don't satisfy `Record<string, ...>` constraints implicitly.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type TaskSnapshotEntry = {
  id: string;
  title: string;
  completed: boolean;
  isPartial: boolean;
  targetDate: string;
  priority?: string;
  notes?: string;
};
