import { isOrgAdmin } from "../lib/access.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as dayClosureRepo from "../repositories/day-closure.repository.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import { canAccessTask, canManageUser } from "../utils/auth.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

// ───────────────────────────────────────────────────────────────────────────
// Sprint 18 (L9): MANAGE — recursive reporting tree.
// ───────────────────────────────────────────────────────────────────────────

export interface TeamTreeNode {
  user: {
    id: string;
    name: string;
    designation: string | null;
    role: string;
    level: number;
    email: string;
  };
  todayProgress: {
    done: number;
    total: number;
    planSubmitted: boolean;
    closureSubmitted: boolean;
  };
  reports: TeamTreeNode[];
}

interface TodayProgress {
  done: number;
  total: number;
  planSubmitted: boolean;
  closureSubmitted: boolean;
}

async function todayProgressForUsers(
  userIds: string[],
  date: Date,
): Promise<Map<string, TodayProgress>> {
  const empty = (): TodayProgress => ({
    done: 0,
    total: 0,
    planSubmitted: false,
    closureSubmitted: false,
  });
  const progress = new Map<string, TodayProgress>();
  for (const id of userIds) progress.set(id, empty());
  if (userIds.length === 0) return progress;

  const [tasks, plans, closures] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: { in: userIds }, targetDate: date, deletedAt: null },
      select: { assigneeId: true, completed: true },
    }),
    prisma.dayPlanSubmission.findMany({
      where: { userId: { in: userIds }, date },
      select: { userId: true },
    }),
    // Sprint 17 Phase 5 alignment: drafts don't count as "closure submitted."
    prisma.dayClosureSubmission.findMany({
      where: { userId: { in: userIds }, date, status: "submitted" },
      select: { userId: true },
    }),
  ]);

  for (const task of tasks) {
    const p = progress.get(task.assigneeId);
    if (!p) continue;
    p.total += 1;
    if (task.completed) p.done += 1;
  }
  for (const plan of plans) {
    const p = progress.get(plan.userId);
    if (p) p.planSubmitted = true;
  }
  for (const closure of closures) {
    const p = progress.get(closure.userId);
    if (p) p.closureSubmitted = true;
  }
  return progress;
}

/**
 * Builds the recursive reporting subtree of the actor's reports.
 *
 * Matrix hierarchy: a person can report to MULTIPLE managers (e.g. a lead under
 * two directors). The tree reflects that honestly — such a person (and their
 * whole subtree) appears under EACH of their managers, not just the first one.
 * `ancestors` is a per-path guard so a bad/cyclic edge can't loop forever.
 *
 * Loading is deduped (each user's reports are queried at most once); placement
 * is NOT — duplication into the tree is intentional. Fine for hospital-size orgs;
 * a pathologically dense matrix could fan out, revisit if that ever shows up.
 */
export async function getTeamTree(actor: AuthenticatedUser): Promise<TeamTreeNode[]> {
  const today = todayInUserTz(DEFAULT_TIMEZONE);

  interface ReportRow {
    id: string;
    name: string;
    designation: string | null;
    role: string;
    level: number;
    email: string;
  }

  // 1. Load every reachable user's direct reports, level by level (load-dedup).
  const reportsOf = new Map<string, ReportRow[]>();
  const loaded = new Set<string>([actor.id]);
  let frontier: string[] = [actor.id];
  while (frontier.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: frontier } },
      select: {
        id: true,
        reports: {
          select: { id: true, name: true, designation: true, role: true, level: true, email: true },
          orderBy: [{ level: "desc" }, { name: "asc" }],
        },
      },
    });
    const next: string[] = [];
    for (const row of rows) {
      reportsOf.set(row.id, row.reports);
      for (const r of row.reports) {
        if (loaded.has(r.id)) continue;
        loaded.add(r.id);
        next.push(r.id);
      }
    }
    frontier = next;
  }

  // 2. One batched progress lookup for every reachable user.
  const progress = await todayProgressForUsers(
    [...loaded].filter((id) => id !== actor.id),
    today,
  );

  // 3. Build the nested tree, duplicating multiply-managed users under each
  //    manager. `ancestors` is the path from the actor to the current node.
  const build = (userId: string, ancestors: ReadonlySet<string>): TeamTreeNode[] => {
    const out: TeamTreeNode[] = [];
    for (const r of reportsOf.get(userId) ?? []) {
      if (ancestors.has(r.id)) continue; // cycle guard
      out.push({
        user: r,
        todayProgress: progress.get(r.id) ?? {
          done: 0,
          total: 0,
          planSubmitted: false,
          closureSubmitted: false,
        },
        reports: build(r.id, new Set(ancestors).add(r.id)),
      });
    }
    return out;
  };

  return build(actor.id, new Set([actor.id]));
}

// ───────────────────────────────────────────────────────────────────────────
// Sprint 18: DIRECTORY — org-wide browsable tree.
// ───────────────────────────────────────────────────────────────────────────

export interface DirectoryGroupNode {
  id: string;
  name: string;
  kind: string;
  leadName: string | null;
  memberCount: number;
  managedByMe: boolean;
}

export interface DirectoryDepartmentNode {
  id: string;
  name: string;
  headName: string | null;
  managedByMe: boolean;
  groups: DirectoryGroupNode[];
}

export interface DirectoryTree {
  org: { id: string; name: string };
  departments: DirectoryDepartmentNode[];
  unassignedStaff: { id: string; name: string; designation: string | null; role: string }[];
  // Total operational (non-admin/root) staff without a group — drives the
  // "Needs placement" count and the "Load more" affordance. `unassignedStaff`
  // is the paginated slice of this set.
  unassignedStaffTotal: number;
}

export interface DirectoryPageOpts {
  limit?: number;
  offset?: number;
}

export async function getDirectory(
  actor: AuthenticatedUser,
  opts?: DirectoryPageOpts,
): Promise<DirectoryTree> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const [org, departments, allUsers, ledGroupIds, headedDeptIds] = await Promise.all([
    prisma.organization.findUnique({ where: { id: actor.orgId } }),
    prisma.department.findMany({
      where: { orgId: actor.orgId },
      include: {
        head: { select: { name: true } },
        groups: {
          include: {
            memberships: {
              where: { validTo: null },
              include: { user: { select: { name: true } } },
            },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { orgId: actor.orgId },
      select: { id: true, name: true, designation: true, role: true },
      // Stable total order (name + unique id) so paginated slices of
      // `unassignedStaff` never shuffle, overlap, or drop across requests.
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.groupMembership
      .findMany({
        where: { userId: actor.id, isLead: true, validTo: null },
        select: { groupId: true },
      })
      .then((rows) => new Set(rows.map((r) => r.groupId))),
    prisma.department
      .findMany({
        where: { orgId: actor.orgId, headId: actor.id },
        select: { id: true },
      })
      .then((rows) => new Set(rows.map((r) => r.id))),
  ]);

  if (!org) throw new NotFoundError("Organization", actor.orgId);

  // Anyone with at least one active group membership is considered "assigned."
  const assignedUsers = new Set<string>();
  for (const dept of departments) {
    for (const group of dept.groups) {
      for (const m of group.memberships) assignedUsers.add(m.userId);
    }
  }

  const departmentNodes: DirectoryDepartmentNode[] = departments.map((dept) => ({
    id: dept.id,
    name: dept.name,
    headName: dept.head?.name ?? null,
    managedByMe: actor.isSuperAdmin || actor.role === "admin" || headedDeptIds.has(dept.id),
    groups: dept.groups
      .filter((g) => g.kind !== "personal")
      .map((group) => {
        const lead = group.memberships.find((m) => m.isLead);
        return {
          id: group.id,
          name: group.name,
          kind: group.kind,
          leadName: lead?.user.name ?? null,
          memberCount: group.memberships.length,
          managedByMe:
            actor.isSuperAdmin ||
            isOrgAdmin(actor.level) ||
            headedDeptIds.has(dept.id) ||
            ledGroupIds.has(group.id),
        };
      }),
  }));

  // Operational staff with no active group membership. Admin/root accounts are
  // excluded here (the directory intentionally hides them) so the total + the
  // paginated slice stay consistent with what the UI shows.
  const unassigned = allUsers
    .filter((u) => !assignedUsers.has(u.id) && u.role !== "admin" && u.role !== "root")
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation, role: u.role }));

  return {
    org: { id: org.id, name: org.name },
    departments: departmentNodes,
    unassignedStaff: unassigned.slice(offset, offset + limit),
    unassignedStaffTotal: unassigned.length,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Sprint 18: scope-aware person drill-down. Replaces the /team/reports/:id
// path for dashboard clicks. Gated by canAccessTask (group leads + dept heads
// allowed since 16A) instead of `requireManagerOf` (direct manager only) —
// this is the fix for the "You are not a manager of this user" red error.
// ───────────────────────────────────────────────────────────────────────────

export interface PersonProfile {
  user: {
    id: string;
    name: string;
    designation: string | null;
    email: string;
    role: string;
    level: number;
  };
  managers: { id: string; name: string }[];
  groups: { id: string; name: string; isLead: boolean }[];
  canManage: boolean;
}

export async function getPersonProfile(
  actor: AuthenticatedUser,
  targetId: string,
): Promise<PersonProfile> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      designation: true,
      email: true,
      role: true,
      level: true,
      orgId: true,
      managers: { select: { id: true, name: true } },
      memberships: {
        where: { validTo: null },
        select: {
          isLead: true,
          group: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!target) throw new NotFoundError("User", targetId);
  if (!actor.isSuperAdmin && target.orgId !== actor.orgId) {
    // Same response as "not found" — never leak existence across orgs.
    throw new NotFoundError("User", targetId);
  }

  return {
    user: {
      id: target.id,
      name: target.name,
      designation: target.designation,
      email: target.email,
      role: target.role,
      level: target.level,
    },
    managers: target.managers,
    groups: target.memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      isLead: m.isLead,
    })),
    canManage: await canManageUser(actor, targetId),
  };
}

export interface PersonDay {
  // Sprint 20: working hours + tz so the manager's read-only day timeline
  // renders against the REPORT's window, not the viewer's.
  user: {
    id: string;
    name: string;
    workStartMinute: number;
    workEndMinute: number;
    timezone: string;
  };
  date: string;
  dayPlan: { id: string; submittedAt: string } | null;
  dayClosure: { id: string; status: "draft" | "submitted"; submittedAt: string } | null;
  tasks: Awaited<ReturnType<typeof taskRepo.listByDate>>;
}

export async function getPersonDay(
  actor: AuthenticatedUser,
  targetId: string,
  dateStr: string | undefined,
): Promise<PersonDay> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      orgId: true,
      workStartMinute: true,
      workEndMinute: true,
      timezone: true,
    },
  });
  if (!target) throw new NotFoundError("User", targetId);
  if (!actor.isSuperAdmin && target.orgId !== actor.orgId) {
    throw new NotFoundError("User", targetId);
  }

  // Scope-aware access: borrow canAccessTask's semantics by checking with a
  // synthetic resource. Same authority that gates per-task edits.
  const hasAccess = await canAccessTask(actor, {
    assigneeId: target.id,
    creatorId: target.id,
  });
  if (!hasAccess) {
    throw new ForbiddenError("This user is outside your management scope.");
  }

  const date = dateStr ? parseDateString(dateStr) : todayInUserTz(DEFAULT_TIMEZONE);
  const [plan, closure, tasks] = await Promise.all([
    dayPlanRepo.findByUserAndDate(target.id, date),
    dayClosureRepo.findByUserAndDate(target.id, date),
    taskRepo.listByDate(target.id, date),
  ]);

  return {
    user: {
      id: target.id,
      name: target.name,
      workStartMinute: target.workStartMinute,
      workEndMinute: target.workEndMinute,
      timezone: target.timezone,
    },
    date: dateStr ?? date.toISOString().slice(0, 10),
    dayPlan: plan ? { id: plan.id, submittedAt: plan.submittedAt.toISOString() } : null,
    dayClosure: closure
      ? {
          id: closure.id,
          status: closure.status as "draft" | "submitted",
          submittedAt: closure.submittedAt.toISOString(),
        }
      : null,
    tasks,
  };
}
