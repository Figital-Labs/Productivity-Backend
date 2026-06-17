import type { AuthenticatedUser } from "../middleware/auth.js";
import * as userRepo from "../repositories/user.repository.js";
import type { SearchUsersQuery, WorkingHoursInput } from "../schemas/users.schema.js";

export interface PublicUserSummary {
  id: string;
  email: string;
  name: string;
  role: "staff" | "manager" | "admin";
  level: number;
}

const SEARCH_RESULT_CAP = 50;

/**
 * Sprint 14 addendum: same-org user search. Used by the manager dashboard's
 * "Add Existing User" picker and reusable by the Meetings page. Excludes
 * `orgId` from the response since it's always the caller's org (no
 * cross-org leakage).
 */
export async function searchSameOrg(
  caller: AuthenticatedUser,
  query: SearchUsersQuery,
): Promise<PublicUserSummary[]> {
  const trimmed = query.q?.trim();
  const rows = await userRepo.searchSameOrg(
    caller.orgId,
    trimmed && trimmed.length > 0 ? trimmed : undefined,
    SEARCH_RESULT_CAP,
    query.forMeeting ? undefined : caller.level,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
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
