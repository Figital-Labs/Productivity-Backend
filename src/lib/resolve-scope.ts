import type { AuthenticatedUser } from "../middleware/auth.js";

import { isOrgAdmin } from "./access.js";
import prisma from "./prisma.js";

export type Scope =
  | { type: "org"; orgId: string }
  | { type: "dept"; departmentIds: string[]; orgId: string }
  | { type: "group"; groupIds: string[]; orgId: string }
  | { type: "reports-only"; reportIds: string[]; orgId: string }
  | { type: "none" };

/**
 * Resolves dashboard visibility for Sprint 16B. Keep this as the single
 * authority source so every dashboard endpoint filters data the same way.
 */
export async function resolveScope(user: AuthenticatedUser): Promise<Scope> {
  if (isOrgAdmin(user.level)) return { type: "org", orgId: user.orgId };

  const headedDepts = await prisma.department.findMany({
    where: { headId: user.id, orgId: user.orgId },
    select: { id: true },
  });
  if (headedDepts.length > 0) {
    return {
      type: "dept",
      departmentIds: headedDepts.map((department) => department.id),
      orgId: user.orgId,
    };
  }

  const ledGroups = await prisma.groupMembership.findMany({
    where: {
      userId: user.id,
      isLead: true,
      validTo: null,
      group: { orgId: user.orgId },
    },
    select: { groupId: true },
  });
  if (ledGroups.length > 0) {
    return {
      type: "group",
      groupIds: ledGroups.map((group) => group.groupId),
      orgId: user.orgId,
    };
  }

  // Relationship signal: anyone who actually has reports gets the reports-only
  // view, regardless of role label (group leads/dept heads are handled above
  // via their dept/group; this is the plain manager-with-reports fallback).
  if (user.reportIds.size > 0) {
    return {
      type: "reports-only",
      reportIds: Array.from(user.reportIds),
      orgId: user.orgId,
    };
  }

  return { type: "none" };
}
