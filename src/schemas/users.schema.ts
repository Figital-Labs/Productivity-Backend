import { z } from "zod";

/**
 * Sprint 14 addendum: query for `GET /users/search?q=<optional>`. Empty/missing
 * `q` returns the full same-org list (capped server-side). Intended for the
 * Add Existing User picker on the manager dashboard and the Meetings invite
 * picker (future).
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().max(120).optional(),
  forMeeting: z.coerce.boolean().optional(),
  // Pagination for lazy-loaded pickers (e.g. the reporting-manager dropdown).
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;

/**
 * Sprint 19: per-user working hours for `PATCH /users/me/working-hours`.
 * Minutes from local midnight; end must be strictly after start.
 */
export const workingHoursSchema = z
  .object({
    workStartMinute: z.number().int().min(0).max(1439),
    workEndMinute: z.number().int().min(1).max(1440),
  })
  .refine((v) => v.workEndMinute > v.workStartMinute, {
    message: "workEndMinute must be after workStartMinute",
  });
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;
