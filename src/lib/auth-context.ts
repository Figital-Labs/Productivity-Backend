/**
 * Rebuild an `AuthenticatedUser` from the database by id — the same shape the `jwtAuth`
 * middleware assembles per request, minus the token. Used by background workers (which have
 * only a userId from the job row) so service code that expects a full authenticated actor
 * (e.g. `dispatchAiAction` → `taskService.getTask` → `canAccessTask`) behaves identically to
 * the request path. Returns `null` if the user no longer exists.
 */
import type { AuthenticatedUser } from "../middleware/auth.js";

import prisma from "./prisma.js";

export async function loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      orgId: true,
      role: true,
      level: true,
      isSuperAdmin: true,
      canManageUsers: true,
      reports: { select: { id: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    role: row.role as AuthenticatedUser["role"],
    reportIds: new Set(row.reports.map((r) => r.id)),
    isSuperAdmin: row.isSuperAdmin,
    canManageUsers: row.canManageUsers,
    level: row.level,
  };
}
