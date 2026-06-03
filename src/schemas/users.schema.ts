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
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
