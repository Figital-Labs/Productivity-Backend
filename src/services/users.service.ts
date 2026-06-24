import { isOrgAdmin } from "../lib/access.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as userRepo from "../repositories/user.repository.js";
import type { SearchUsersQuery, WorkingHoursInput } from "../schemas/users.schema.js";

export interface PublicUserSummary {
  id: string;
  email: string;
  name: string;
  designation: string | null;
  role: "staff" | "manager" | "admin";
  level: number;
}

/**
 * Sprint 14 addendum: same-org user search. Used by the manager dashboard's
 * "Add Existing User" picker, the reporting-manager picker, and the Meetings
 * page. Paginated (limit/offset) for lazy-loaded dropdowns. Excludes `orgId`
 * from the response since it's always the caller's org (no cross-org leakage).
 *
 * Level ceiling: non-admins only see users below their own level. Org admins
 * (and the meetings picker) see everyone in the org — an admin assigning a
 * reporting manager must be able to pick anyone, including other admins.
 */
export async function searchSameOrg(
  caller: AuthenticatedUser,
  query: SearchUsersQuery,
): Promise<PublicUserSummary[]> {
  const trimmed = query.q?.trim();
  const seesAllLevels = query.forMeeting === true || isOrgAdmin(caller.level);
  const rows = await userRepo.searchSameOrg(
    caller.orgId,
    trimmed && trimmed.length > 0 ? trimmed : undefined,
    query.limit,
    seesAllLevels ? undefined : caller.level,
    query.offset,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    designation: r.designation,
    role: r.role as PublicUserSummary["role"],
    level: r.level,
  }));
}

/**
 * Sprint 19: update the caller's own working-hours window. Validation (end >
 * start, 0–1440 range) is enforced at the schema boundary.
 */
export async function updateWorkingHours(
  user: AuthenticatedUser,
  input: WorkingHoursInput,
): Promise<{ workStartMinute: number; workEndMinute: number }> {
  const updated = await userRepo.updateWorkingHours(user.id, {
    workStartMinute: input.workStartMinute,
    workEndMinute: input.workEndMinute,
  });
  return { workStartMinute: updated.workStartMinute, workEndMinute: updated.workEndMinute };
}
