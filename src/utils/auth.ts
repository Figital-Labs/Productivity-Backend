import { isOrgAdmin } from "../lib/access.js";
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
  return user.id === resource.userId || isOrgAdmin(user.level);
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
  if (isOrgAdmin(user.level)) return true;
  if (task.assigneeId === user.id) return true;
  if (task.creatorId === user.id) return true;
  if (user.reportIds.has(task.assigneeId)) return true;

  // The assignee is reachable if they're in a group that the actor either
  // LEADS (group-lead authority, since 16A) or whose DEPARTMENT the actor
  // HEADS (dept-head authority, Sprint 18). One query covers both so a dept
  // head can drill into any member of their department's groups without a
  // direct reports-edge.
  const scopedGroup = await prisma.groupMembership.findFirst({
    where: {
      userId: task.assigneeId,
      validTo: null,
      group: {
        orgId: user.orgId,
        OR: [
          { memberships: { some: { userId: user.id, isLead: true, validTo: null } } },
          { department: { headId: user.id } },
        ],
      },
    },
    select: { groupId: true },
  });
  return scopedGroup !== null;
}

/**
 * Sprint 18 (L7): recursive reporting subtree. Returns the set of every user
 * id reachable from `actorId` by walking the `_UserHierarchy` reports edges
 * downward (direct reports → their reports → grandchildren …). The actor
 * themselves is NOT included. Matrix-safe: a node reachable by multiple paths
 * is returned once. BFS with a `seen` set to avoid cycles (defensive — the
 * model shouldn't have any, but the matrix doesn't formally rule them out).
 */
export async function reportSubtreeIds(actorId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier: string[] = [actorId];
  while (frontier.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: frontier } },
      select: { reports: { select: { id: true } } },
    });
    const next: string[] = [];
    for (const row of rows) {
      for (const r of row.reports) {
        if (!seen.has(r.id) && r.id !== actorId) {
          seen.add(r.id);
          next.push(r.id);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * OPERATIONAL authority: "may I see/delegate to this user?" Used by the
 * manager surfaces — view a report's tasks/plans, delegate a task. True iff
 *
 *     actor is root super-admin (cross-org), OR
 *     actor is same-org admin, OR
 *     target is anywhere in actor's reporting subtree (transitive, down the chain)
 *
 * NOTE: intentionally no level ceiling and no `canManageUsers` flag — a manager
 * manages their reports purely by virtue of the reporting edge (matches the
 * flat model where a manager and their report may share a level). Account
 * mutations (create/edit/reset-password) are a SEPARATE, admin-only authority —
 * see `isOrgAdmin` / the requireOrgAdmin middleware.
 */
export async function inReportingScope(
  actor: AuthenticatedUser,
  targetId: string,
): Promise<boolean> {
  if (actor.isSuperAdmin) return true;
  if (isOrgAdmin(actor.level)) return true;
  const subtree = await reportSubtreeIds(actor.id);
  return subtree.has(targetId);
}

/**
 * Sprint 18 (L7+L8): the central "may I act on this user?" authority.
 *
 *   true iff
 *     actor is root super-admin (cross-org), OR
 *     actor is same-org admin, OR
 *     (actor.canManageUsers AND target is in actor's reporting subtree
 *      AND target.level < actor.level)
 *
 * Returns false if actor and target are in different orgs (root excepted).
 * Use this everywhere a user-mutation is gated: create-user, edit, delegate,
 * password reset, group lead change. Returns false (not throws) so callers
 * can decide between 403 and silently hiding a UI affordance.
 */
export async function canManageUser(actor: AuthenticatedUser, targetId: string): Promise<boolean> {
  if (actor.id === targetId) return false; // never edit yourself via these flows
  if (actor.isSuperAdmin) return true;

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { orgId: true, level: true },
  });
  if (target?.orgId !== actor.orgId) return false;

  if (isOrgAdmin(actor.level)) return true;
  if (!actor.canManageUsers) return false;
  if (target.level >= actor.level) return false;

  const subtree = await reportSubtreeIds(actor.id);
  return subtree.has(targetId);
}

/**
 * Like `canManageUser` but for the create-user case where the target doesn't
 * exist yet. Checks the level ceiling + the actor's `canManageUsers` flag.
 * The subtree check doesn't apply at creation time (the new user will be
 * wired to the actor as a manager).
 */
export function canCreateUserAtLevel(actor: AuthenticatedUser, targetLevel: number): boolean {
  if (actor.isSuperAdmin) return true;
  if (isOrgAdmin(actor.level)) return true;
  if (!actor.canManageUsers) return false;
  return targetLevel < actor.level;
}
