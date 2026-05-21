import { z } from "zod";

import { dateStringSchema } from "./common.js";

export const toggleHolidayInputSchema = z.object({
  date: dateStringSchema,
  reason: z.string().max(500).optional(),
});
export type ToggleHolidayInput = z.infer<typeof toggleHolidayInputSchema>;

export const listHolidaysQuerySchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
  })
  .refine((v) => v.from <= v.to, {
    message: "`from` must be on or before `to`",
  });
export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;
