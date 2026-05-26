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

function requireManagerOf(manager: AuthenticatedUser, targetUserId: string): void {
  if (manager.role === "admin") return;
  if (!manager.reportIds.has(targetUserId)) {
    throw new ForbiddenError("You are not a manager of this user");
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
    prisma.dayClosureSubmission.findMany({
      where: { userId: { in: reportIds }, date: today },
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
  requireManagerOf(manager, reportId);
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
  requireManagerOf(manager, reportId);
  const [dayPlan, dayClosure] = await Promise.all([
    dayPlanRepo.findByUserAndDate(reportId, date),
    dayClosureRepo.findByUserAndDate(reportId, date),
  ]);
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
  requireManagerOf(manager, input.assigneeId);
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
export async function createUser(
  creator: AuthenticatedUser,
  input: CreateTeamUserInput,
): Promise<PublicTeamUser> {
  // Email uniqueness check before transaction — fail fast.
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("USER_ALREADY_EXISTS", "A user with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  const created = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role,
        orgId: creator.orgId,
      },
    });
    // Wire creator → newUser in the hierarchy m2m. `reports` field on the
    // creator picks up the new user.
    await tx.user.update({
      where: { id: creator.id },
      data: { reports: { connect: { id: newUser.id } } },
    });
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

/**
 * Manager resets a report's password. Manager must manage the target user.
 */
export async function resetUserPassword(
  manager: AuthenticatedUser,
  targetUserId: string,
  input: ResetTeamUserPasswordInput,
): Promise<void> {
  requireManagerOf(manager, targetUserId);
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new NotFoundError("User", targetUserId);
  const passwordHash = await hashPassword(input.password);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
}
