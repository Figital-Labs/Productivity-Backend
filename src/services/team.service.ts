import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type { DayClosureSubmission } from "../repositories/day-closure.repository.js";
import * as dayClosureRepo from "../repositories/day-closure.repository.js";
import type { DayPlanSubmission } from "../repositories/day-plan.repository.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import type { Task } from "../repositories/task.repository.js";
import type {
  AttachExistingUserInput,
  CreateDelegatedTaskInput,
  CreateTeamUserInput,
  ResetTeamUserPasswordInput,
} from "../schemas/team.schema.js";
import { canCreateUserAtLevel } from "../utils/auth.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

import { addUserToPersonalDirects } from "./personal-directs.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface PublicTeamUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
}

export interface ReportProgress {
  done: number;
  total: number;
  planSubmitted: boolean;
  closureSubmitted: boolean;
}

export interface ReportWithProgress extends PublicTeamUser {
  todayProgress: ReportProgress;
}

function toPublicTeamUser(u: {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
}): PublicTeamUser {
  // Role is validated at the user creation boundary; trust it here.
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    orgId: u.orgId,
    role: u.role as PublicTeamUser["role"],
  };
}

async function requireCanManage(manager: AuthenticatedUser, targetUserId: string): Promise<void> {
  if (manager.isSuperAdmin) return;
  if (!manager.reportIds.has(targetUserId)) {
    throw new ForbiddenError("You are not a manager of this user");
  }
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { level: true },
  });
  if (!target) throw new NotFoundError("User", targetUserId);
  if (target.level >= manager.level) {
    throw new ForbiddenError("You cannot manage a user at or above your level");
  }
}

/**
 * Rollup of the manager's direct reports + today's progress (done/total) +
 * day-plan / day-closure submission status. Single grouped query for counts
 * to avoid N+1.
 */
export async function listReports(manager: AuthenticatedUser): Promise<ReportWithProgress[]> {
  const row = await prisma.user.findUnique({
    where: { id: manager.id },
    select: {
      reports: {
        select: { id: true, email: true, name: true, orgId: true, role: true },
        orderBy: { name: "asc" },
      },
    },
  });
  const reports = row?.reports ?? [];
  if (reports.length === 0) return [];

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const reportIds = reports.map((r) => r.id);

  // Counts by assignee + completed (one query, indexed by [assigneeId, targetDate]).
  const counts = await prisma.task.groupBy({
    by: ["assigneeId", "completed"],
    where: { assigneeId: { in: reportIds }, targetDate: today, deletedAt: null },
    _count: { _all: true },
  });

  // Plan + closure submission flags for today.
  const [plans, closures] = await Promise.all([
    prisma.dayPlanSubmission.findMany({
      where: { userId: { in: reportIds }, date: today },
      select: { userId: true },
    }),
    // Sprint 17 Phase 5: a draft must NOT flip the manager's "closure
    // submitted ✓" badge on the reports list. Only finalized closures do.
    prisma.dayClosureSubmission.findMany({
      where: { userId: { in: reportIds }, date: today, status: "submitted" },
      select: { userId: true },
    }),
  ]);
  const planUserIds = new Set(plans.map((p) => p.userId));
  const closureUserIds = new Set(closures.map((c) => c.userId));

  return reports.map((r) => {
    let done = 0;
    let total = 0;
    for (const c of counts) {
      if (c.assigneeId !== r.id) continue;
      total += c._count._all;
      if (c.completed) done += c._count._all;
    }
    return {
      ...toPublicTeamUser(r),
      todayProgress: {
        done,
        total,
        planSubmitted: planUserIds.has(r.id),
        closureSubmitted: closureUserIds.has(r.id),
      },
    };
  });
}

/**
 * Read-only fetch of a specific report's tasks for a given date. The manager
 * must manage the target user (or be admin).
 */
export async function getReportTasks(
  manager: AuthenticatedUser,
  reportId: string,
  date: Date,
): Promise<Task[]> {
  await requireCanManage(manager, reportId);
  return taskRepo.listByDate(reportId, date);
}

/**
 * Read-only fetch of a report's day-plan + day-closure submissions for a
 * given date. Either can be null if not submitted yet.
 */
export async function getReportSubmissions(
  manager: AuthenticatedUser,
  reportId: string,
  date: Date,
): Promise<{ dayPlan: DayPlanSubmission | null; dayClosure: DayClosureSubmission | null }> {
  await requireCanManage(manager, reportId);
  const [dayPlan, dayClosureRow] = await Promise.all([
    dayPlanRepo.findByUserAndDate(reportId, date),
    dayClosureRepo.findByUserAndDate(reportId, date),
  ]);
  // Sprint 17 Phase 5: the manager drill-down represents what the report
  // has "submitted." A draft is the report's private, unsubmitted state —
  // surface it to the manager as "no closure yet" (null) until finalized.
  const dayClosure = dayClosureRow?.status === "submitted" ? dayClosureRow : null;
  return { dayPlan, dayClosure };
}

/**
 * Manual delegation — manager fills a form (no AI) and assigns a task to a
 * report. Mirrors `taskService.createTask` but creator !== assignee.
 */
export async function createDelegatedTask(
  manager: AuthenticatedUser,
  input: CreateDelegatedTaskInput,
): Promise<Task> {
  await requireCanManage(manager, input.assigneeId);
  const targetDate = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);
  return taskRepo.create({
    assigneeId: input.assigneeId,
    creatorId: manager.id,
    title: input.title,
    targetDate,
    sourceType: "manual",
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.priority !== undefined && { priority: input.priority }),
  });
}

/**
 * Manager creates a user (staff or sub-manager) under them. The creator is
 * wired as a manager of the new user via the m2m hierarchy. Org is
 * inherited from the creator. Password is hashed before persisting.
 */
/**
 * Sprint 18 (L3): map a hierarchy `roleType` to its default
 * (role, level, canManageUsers). The caller may still override any of these
 * via explicit fields on the input.
 */
function resolveHierarchyDefaults(input: CreateTeamUserInput): {
  role: "staff" | "manager" | "admin";
  level: number;
  canManageUsers: boolean;
} {
  switch (input.roleType) {
    case "director":
      return { role: "admin", level: 800, canManageUsers: true };
    case "dept_head":
      return { role: "manager", level: 400, canManageUsers: true };
    case "group_lead":
      // Group leads coordinate a single group; they manage downward within it
      // but sit below dept heads in the chain.
      return { role: "manager", level: 300, canManageUsers: true };
    case "staff":
      return { role: "staff", level: 100, canManageUsers: false };
    case "custom":
      // Custom requires explicit role + level from the caller.
      if (!input.role || input.level === undefined) {
        throw new AppError(
          "VALIDATION_ERROR",
          400,
          "roleType=custom requires explicit role and level.",
        );
      }
      return { role: input.role, level: input.level, canManageUsers: false };
    case undefined: {
      // Legacy path: no `roleType` provided. Use input.role and a default
      // level so existing FE flows keep working. The legacy schema only
      // accepts staff/manager; admin can only come through `roleType=director`.
      const role: "staff" | "manager" = input.role ?? "staff";
      const level = input.level ?? (role === "manager" ? 400 : 100);
      const canManageUsers = role === "manager";
      return { role, level, canManageUsers };
    }
  }
}

export async function createUser(
  creator: AuthenticatedUser,
  input: CreateTeamUserInput,
): Promise<PublicTeamUser> {
  // L8 guardrail: only users with the create-users permission may proceed.
  if (!creator.isSuperAdmin && creator.role !== "admin" && !creator.canManageUsers) {
    throw new ForbiddenError("You do not have permission to create users.");
  }

  const defaults = resolveHierarchyDefaults(input);
  const resolvedRole = defaults.role;
  const resolvedLevel = input.level ?? defaults.level;
  const resolvedCanManageUsers = input.canManageUsers ?? defaults.canManageUsers;

  // L7 ceiling: never mint a user at level >= your own (root + admin excepted).
  if (!canCreateUserAtLevel(creator, resolvedLevel)) {
    throw new ForbiddenError(
      `You cannot create a user at level ${resolvedLevel.toString()} — your level is ${creator.level.toString()}.`,
    );
  }

  // Email uniqueness check before transaction — fail fast.
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("USER_ALREADY_EXISTS", "A user with this email already exists.");
  }

  // Sanity-check that any referenced dept/group exist and are in-org.
  if (input.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
    if (dept?.orgId !== creator.orgId) throw new NotFoundError("Department", input.departmentId);
  }
  if (input.groupId) {
    const group = await prisma.contextGroup.findUnique({ where: { id: input.groupId } });
    if (group?.orgId !== creator.orgId) throw new NotFoundError("Group", input.groupId);
  }

  const passwordHash = await hashPassword(input.password);
  const managerIds =
    input.managerIds && input.managerIds.length > 0 ? input.managerIds : [creator.id];

  const created = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: resolvedRole,
        level: resolvedLevel,
        canManageUsers: resolvedCanManageUsers,
        orgId: creator.orgId,
      },
    });

    // Wire manager edges. Always include the creator so they can drill into
    // the new user immediately (unless explicitly excluded by `managerIds`).
    await tx.user.update({
      where: { id: newUser.id },
      data: { managers: { connect: managerIds.map((id) => ({ id })) } },
    });

    // dept_head → set Department.headId on the chosen department.
    if (input.roleType === "dept_head" && input.departmentId) {
      await tx.department.update({
        where: { id: input.departmentId },
        data: { headId: newUser.id },
      });
    }

    // If a groupId is provided, add membership. group_lead implies isLead=true
    // by default; other types default to a regular member.
    if (input.groupId) {
      const wantsLead = input.isLead ?? input.roleType === "group_lead";
      // Demote any currently-active lead in this group if we're becoming lead.
      if (wantsLead) {
        await tx.groupMembership.updateMany({
          where: { groupId: input.groupId, validTo: null, isLead: true },
          data: { isLead: false },
        });
      }
      await tx.groupMembership.create({
        data: {
          userId: newUser.id,
          groupId: input.groupId,
          isLead: wantsLead,
          canManage: wantsLead,
        },
      });
    }

    return newUser;
  });

  return toPublicTeamUser(created);
}

/**
 * Sprint 14: manager attaches an EXISTING same-org user as a report. No new
 * account is created; only the m2m hierarchy edge is added. Idempotency
 * surfaces as 409 — managers should know they already manage this person
 * rather than silently no-op. Note: `creator.reportIds` on the request is
 * computed in middleware and won't update within the same request after the
 * attach; the next request will see the new edge.
 */
export async function attachExistingUser(
  creator: AuthenticatedUser,
  input: AttachExistingUserInput,
): Promise<PublicTeamUser> {
  const target = await prisma.user.findUnique({ where: { email: input.email } });
  if (target?.orgId !== creator.orgId) {
    throw new NotFoundError("User");
  }
  if (target.id === creator.id) {
    throw new AppError("CANNOT_ATTACH_SELF", 400, "Cannot attach yourself as a report");
  }
  if (target.role === "admin") {
    throw new AppError("CANNOT_ATTACH_ADMIN", 403, "Cannot attach an admin as a report");
  }
  if (target.level >= creator.level) {
    throw new ForbiddenError("Cannot attach a user at or above your level as a report");
  }
  if (creator.reportIds.has(target.id)) {
    throw new ConflictError("ALREADY_A_REPORT", "This user already reports to you.");
  }

  await prisma.user.update({
    where: { id: creator.id },
    data: { reports: { connect: { id: target.id } } },
  });
  await addUserToPersonalDirects(creator, target.id);

  return toPublicTeamUser(target);
}

export async function detachReport(manager: AuthenticatedUser, reportId: string): Promise<void> {
  if (!manager.reportIds.has(reportId)) {
    throw new NotFoundError("Report", reportId);
  }
  await prisma.user.update({
    where: { id: manager.id },
    data: { reports: { disconnect: { id: reportId } } },
  });
}

/**
 * Manager resets a report's password. Manager must manage the target user.
 */
export async function resetUserPassword(
  manager: AuthenticatedUser,
  targetUserId: string,
  input: ResetTeamUserPasswordInput,
): Promise<void> {
  await requireCanManage(manager, targetUserId);
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new NotFoundError("User", targetUserId);
  const passwordHash = await hashPassword(input.password);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
}
