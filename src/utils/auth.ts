import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";

interface OwnedResource {
  userId: string;
}

interface TaskResource {
  assigneeId: string;
  creatorId: string;
}

/**
 * Generic ownership check for resources that still carry a single `userId`
 * (notes, alerts, holidays, day plans, day closures, AI interaction audit
 * rows). For tasks — which split into assignee + creator after Sprint 11 —
 * use `canAccessTask` instead.
 */
export function canAccess(user: AuthenticatedUser, resource: OwnedResource): boolean {
  return user.id === resource.userId || user.role === "admin";
}

/**
 * Sprint 11: tasks now have separate assignee and creator. A user can read
 * or edit a task if:
 *   - they're admin, OR
 *   - they're the assignee (their own work), OR
 *   - they're the creator (they delegated it), OR
 *   - they're a manager of the assignee (matrix authority).
 *
 * Note: this is intentionally broad. A consultant who manages a staff nurse
 * sees all of her tasks regardless of who assigned them — knowing how loaded
 * staff are is hospital reality.
 */
export async function canAccessTask(user: AuthenticatedUser, task: TaskResource): Promise<boolean> {
  if (user.role === "admin") return true;
  if (task.assigneeId === user.id) return true;
  if (task.creatorId === user.id) return true;
  if (user.reportIds.has(task.assigneeId)) return true;

  const ledSharedGroup = await prisma.groupMembership.findFirst({
    where: {
      userId: user.id,
      isLead: true,
      validTo: null,
      group: {
        orgId: user.orgId,
        memberships: {
          some: {
            userId: task.assigneeId,
            validTo: null,
          },
        },
      },
    },
    select: { groupId: true },
  });
  return ledSharedGroup !== null;
}
