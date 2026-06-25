import { isOrgAdmin } from "../lib/access.js";
import { AppError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import prisma from "../lib/prisma.js";
import type { Scope } from "../lib/resolve-scope.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type {
  AddGroupMemberInput,
  ConsistencyRow,
  CreateDepartmentInput,
  CreateGroupInput,
  CreateReminderInput,
  DashboardGroupsQuery,
  DashboardMeetingsQuery,
  DashboardPeopleQuery,
  Kpis,
  TrendSeries,
  UpdateDepartmentInput,
  UpdateGroupInput,
} from "../schemas/dashboard.schema.js";
import { reportSubtreeIds } from "../utils/auth.js";
import { dayBoundsInTz, formatDateYmd, parseDateString, todayInUserTz } from "../utils/date.js";
import { omitUndefined } from "../utils/object.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface DepartmentCard {
  id: string;
  name: string;
  headName: string | null;
  kpis: Kpis;
}

export interface GroupCard {
  id: string;
  name: string;
  kind: string;
  departmentId: string | null;
  activeStaff: number;
  leadNames: string[];
  kpis: Kpis;
}

export interface PersonRow {
  user: { id: string; name: string; email: string; role: string; designation: string | null };
  todayKpis: Kpis;
  weekKpis: Kpis;
  consistencyScore: number;
}

export interface DashboardMeeting {
  id: string;
  title: string;
  attendeeCount: number;
  status: "processed" | "scheduled";
  summaryExcerpt: string | null;
  scheduledAt: string;
  processedAt: string | null;
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function rangeDays(days: number, endDate = todayInUserTz(DEFAULT_TIMEZONE)): Date[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date;
  });
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

function requireScope(scope: Scope): Exclude<Scope, { type: "none" }> {
  if (scope.type === "none") throw new ForbiddenError();
  return scope;
}

export async function userIdsInScope(scope: Scope): Promise<string[]> {
  if (scope.type === "none") return [];
  if (scope.type === "org") {
    const users = await prisma.user.findMany({
      where: { orgId: scope.orgId },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
  if (scope.type === "dept") {
    const memberships = await prisma.groupMembership.findMany({
      where: {
        validTo: null,
        group: { orgId: scope.orgId, departmentId: { in: scope.departmentIds } },
      },
      select: { userId: true },
    });
    return unique(memberships.map((membership) => membership.userId));
  }
  if (scope.type === "group") {
    const memberships = await prisma.groupMembership.findMany({
      where: {
        validTo: null,
        group: { orgId: scope.orgId, id: { in: scope.groupIds } },
      },
      select: { userId: true },
    });
    return unique(memberships.map((membership) => membership.userId));
  }
  // reports-only: the manager's WHOLE team — direct reports + everyone below
  // them (transitive subtree), deduped — so every KPI/analytic matches the
  // team table rather than only direct reports.
  return Array.from(await reportSubtreeIds(scope.actorId));
}

export async function kpisForUsers(
  userIds: string[],
  targetDate = todayInUserTz(DEFAULT_TIMEZONE),
): Promise<Kpis> {
  const scopedUserIds = unique(userIds);
  if (scopedUserIds.length === 0) {
    return {
      activeStaffToday: 0,
      plansSubmittedToday: 0,
      plansSubmittedPct: 0,
      closuresSubmittedToday: 0,
      closuresSubmittedPct: 0,
      totalTasks: 0,
      tasksDone: 0,
      tasksDonePct: 0,
    };
  }

  const [plansSubmittedToday, closuresSubmittedToday, taskCounts] = await Promise.all([
    prisma.dayPlanSubmission.count({
      where: { userId: { in: scopedUserIds }, date: targetDate },
    }),
    // Sprint 17 Phase 5: a draft row is NOT a real closure. Filter
    // explicitly so the KPI counts only finalized submissions.
    prisma.dayClosureSubmission.count({
      where: { userId: { in: scopedUserIds }, date: targetDate, status: "submitted" },
    }),
    prisma.task.groupBy({
      by: ["completed"],
      where: { assigneeId: { in: scopedUserIds }, targetDate, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const totalTasks = taskCounts.reduce((sum, row) => sum + row._count._all, 0);
  const tasksDone = taskCounts
    .filter((row) => row.completed)
    .reduce((sum, row) => sum + row._count._all, 0);

  return {
    activeStaffToday: scopedUserIds.length,
    plansSubmittedToday,
    plansSubmittedPct: pct(plansSubmittedToday, scopedUserIds.length),
    closuresSubmittedToday,
    closuresSubmittedPct: pct(closuresSubmittedToday, scopedUserIds.length),
    totalTasks,
    tasksDone,
    tasksDonePct: pct(tasksDone, totalTasks),
  };
}

export async function kpisForUsersInRange(userIds: string[], days: number): Promise<Kpis> {
  const scopedUserIds = unique(userIds);
  if (scopedUserIds.length === 0) return kpisForUsers([]);
  const dates = rangeDays(days);
  const [plansSubmittedToday, closuresSubmittedToday, taskCounts] = await Promise.all([
    prisma.dayPlanSubmission.count({
      where: { userId: { in: scopedUserIds }, date: { in: dates } },
    }),
    // Sprint 17 Phase 5: only finalized closures count.
    prisma.dayClosureSubmission.count({
      where: { userId: { in: scopedUserIds }, date: { in: dates }, status: "submitted" },
    }),
    prisma.task.groupBy({
      by: ["completed"],
      where: { assigneeId: { in: scopedUserIds }, targetDate: { in: dates }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const totalTasks = taskCounts.reduce((sum, row) => sum + row._count._all, 0);
  const tasksDone = taskCounts
    .filter((row) => row.completed)
    .reduce((sum, row) => sum + row._count._all, 0);
  return {
    activeStaffToday: scopedUserIds.length,
    plansSubmittedToday,
    plansSubmittedPct: pct(plansSubmittedToday, scopedUserIds.length),
    closuresSubmittedToday,
    closuresSubmittedPct: pct(closuresSubmittedToday, scopedUserIds.length),
    totalTasks,
    tasksDone,
    tasksDonePct: pct(tasksDone, totalTasks),
  };
}

export async function trendForUsers(
  userIds: string[],
  metric: "tasks" | "plans" | "closures",
  days: number,
): Promise<TrendSeries> {
  const scopedUserIds = unique(userIds);
  const currentDates = rangeDays(days);
  const previousDates = rangeDays(
    days,
    new Date(currentDates[0] ?? todayInUserTz(DEFAULT_TIMEZONE)),
  );
  for (const date of previousDates) date.setUTCDate(date.getUTCDate() - 1);

  const allDates = [...currentDates, ...previousDates];
  const countByDate = new Map<string, number>();

  if (scopedUserIds.length > 0) {
    if (metric === "tasks") {
      const rows = await prisma.task.groupBy({
        by: ["targetDate"],
        where: {
          assigneeId: { in: scopedUserIds },
          targetDate: { in: allDates },
          completed: true,
          deletedAt: null,
        },
        _count: { _all: true },
      });
      for (const r of rows) countByDate.set(formatDateYmd(r.targetDate), r._count._all);
    } else if (metric === "plans") {
      const rows = await prisma.dayPlanSubmission.groupBy({
        by: ["date"],
        where: { userId: { in: scopedUserIds }, date: { in: allDates } },
        _count: { _all: true },
      });
      for (const r of rows) countByDate.set(formatDateYmd(r.date), r._count._all);
    } else {
      // Sprint 17 Phase 5: only finalized closures count on the trend chart.
      const rows = await prisma.dayClosureSubmission.groupBy({
        by: ["date"],
        where: { userId: { in: scopedUserIds }, date: { in: allDates }, status: "submitted" },
        _count: { _all: true },
      });
      for (const r of rows) countByDate.set(formatDateYmd(r.date), r._count._all);
    }
  }

  const currentValues = currentDates.map((d) => countByDate.get(formatDateYmd(d)) ?? 0);
  const previousValues = previousDates.map((d) => countByDate.get(formatDateYmd(d)) ?? 0);
  const currentSum = currentValues.reduce((sum, value) => sum + value, 0);
  const previousSum = previousValues.reduce((sum, value) => sum + value, 0);

  return {
    series: currentDates.map((date, index) => ({
      date: formatDateYmd(date),
      value: currentValues[index] ?? 0,
    })),
    deltaPct:
      previousSum === 0 ? (currentSum > 0 ? 100 : 0) : pct(currentSum - previousSum, previousSum),
  };
}

export async function consistencyForUsers(
  userIds: string[],
  days: number,
): Promise<ConsistencyRow[]> {
  const scopedUserIds = unique(userIds);
  if (scopedUserIds.length === 0) return [];
  const dates = rangeDays(days);
  const [users, plans, closures, holidays] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: scopedUserIds } },
      select: { id: true, name: true, role: true, designation: true },
      orderBy: { name: "asc" },
    }),
    prisma.dayPlanSubmission.findMany({
      where: { userId: { in: scopedUserIds }, date: { in: dates } },
      select: { userId: true, submittedAt: true, date: true },
    }),
    // Sprint 17 Phase 5: drafts must NOT count toward consistency. A user
    // who only "reviewed" but never submitted still missed that day's
    // closure — which is exactly what powers People-to-Watch.
    prisma.dayClosureSubmission.findMany({
      where: { userId: { in: scopedUserIds }, date: { in: dates }, status: "submitted" },
      select: { userId: true, submittedAt: true, date: true },
    }),
    prisma.holiday.findMany({
      where: { userId: { in: scopedUserIds }, date: { in: dates } },
      select: { userId: true, date: true },
    }),
  ]);

  const planKeys = new Set(plans.map((plan) => `${plan.userId}:${formatDateYmd(plan.date)}`));
  const closureKeys = new Set(
    closures.map((closure) => `${closure.userId}:${formatDateYmd(closure.date)}`),
  );
  const holidayKeys = new Set(holidays.map((h) => `${h.userId}:${formatDateYmd(h.date)}`));
  const lastByUser = new Map<string, Date>();
  for (const row of [...plans, ...closures]) {
    const previous = lastByUser.get(row.userId);
    if (previous === undefined || previous < row.submittedAt)
      lastByUser.set(row.userId, row.submittedAt);
  }

  return users
    .map((user): ConsistencyRow => {
      const planMissedDays = dates.filter(
        (date) =>
          !planKeys.has(`${user.id}:${formatDateYmd(date)}`) &&
          !holidayKeys.has(`${user.id}:${formatDateYmd(date)}`),
      ).length;
      const closureMissedDays = dates.filter(
        (date) =>
          !closureKeys.has(`${user.id}:${formatDateYmd(date)}`) &&
          !holidayKeys.has(`${user.id}:${formatDateYmd(date)}`),
      ).length;
      return {
        user,
        planMissedDays,
        closureMissedDays,
        lastSubmittedAt: lastByUser.get(user.id)?.toISOString() ?? null,
      };
    })
    .sort(
      (a, b) => b.planMissedDays + b.closureMissedDays - (a.planMissedDays + a.closureMissedDays),
    );
}

export async function departmentsForScope(scope: Scope): Promise<DepartmentCard[]> {
  if (scope.type === "none") return [];
  const safeScope = requireScope(scope);
  const departments = await prisma.department.findMany({
    where:
      safeScope.type === "org"
        ? { orgId: safeScope.orgId }
        : safeScope.type === "dept"
          ? { orgId: safeScope.orgId, id: { in: safeScope.departmentIds } }
          : {
              orgId: safeScope.orgId,
              groups: {
                some: {
                  memberships: {
                    some: {
                      userId: {
                        in:
                          safeScope.type === "group"
                            ? await userIdsInScope(safeScope)
                            : safeScope.reportIds,
                      },
                      validTo: null,
                    },
                  },
                },
              },
            },
    include: { head: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    departments.map(async (department) => {
      const userIds = await userIdsInDepartment(department.id, safeScope.orgId);
      return {
        id: department.id,
        name: department.name,
        headName: department.head?.name ?? null,
        kpis: await kpisForUsers(userIds),
      };
    }),
  );
}

async function userIdsInDepartment(departmentId: string, orgId: string): Promise<string[]> {
  const memberships = await prisma.groupMembership.findMany({
    where: { validTo: null, group: { orgId, departmentId } },
    select: { userId: true },
  });
  return unique(memberships.map((membership) => membership.userId));
}

export async function groupsForScope(
  scope: Scope,
  query: DashboardGroupsQuery,
): Promise<GroupCard[]> {
  if (scope.type === "none") return [];
  const safeScope = requireScope(scope);
  const scopeUserIds = await userIdsInScope(safeScope);
  const groups = await prisma.contextGroup.findMany({
    where: {
      orgId: safeScope.orgId,
      ...(query.departmentId !== undefined ? { departmentId: query.departmentId } : {}),
      ...(query.include === "personal" ? {} : { kind: { not: "personal" } }),
      ...(safeScope.type === "org"
        ? {}
        : safeScope.type === "dept"
          ? { departmentId: { in: safeScope.departmentIds } }
          : safeScope.type === "group"
            ? { id: { in: safeScope.groupIds } }
            : {
                memberships: { some: { userId: { in: scopeUserIds }, validTo: null } },
              }),
    },
    include: {
      memberships: {
        where: { validTo: null },
        include: { user: { select: { name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    groups.map(async (group) => {
      const memberIds = unique(group.memberships.map((membership) => membership.userId));
      return {
        id: group.id,
        name: group.name,
        kind: group.kind,
        departmentId: group.departmentId,
        activeStaff: memberIds.length,
        leadNames: group.memberships
          .filter((membership) => membership.isLead)
          .map((membership) => membership.user.name),
        kpis: await kpisForUsers(memberIds),
      };
    }),
  );
}

export async function peopleForScope(
  scope: Scope,
  query: DashboardPeopleQuery,
): Promise<PersonRow[]> {
  if (scope.type === "none") return [];
  const safeScope = requireScope(scope);
  let userIds = await userIdsInScope(safeScope);
  if (query.scope === "dept" && query.id !== undefined) {
    userIds = await userIdsInDepartment(query.id, safeScope.orgId);
  } else if (query.scope === "group" && query.id !== undefined) {
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId: query.id, validTo: null, group: { orgId: safeScope.orgId } },
      select: { userId: true },
    });
    userIds = memberships.map((membership) => membership.userId);
  }
  const allowed = new Set(await userIdsInScope(safeScope));
  userIds = unique(userIds).filter((id) => allowed.has(id));

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const weekDates = rangeDays(7);

  const [
    users,
    consistency,
    planCountsToday,
    closureCountsToday,
    taskCountsToday,
    planCountsWeek,
    closureCountsWeek,
    taskCountsWeek,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true, designation: true },
      orderBy: { name: "asc" },
    }),
    consistencyForUsers(userIds, 7),
    prisma.dayPlanSubmission.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, date: today },
      _count: { _all: true },
    }),
    prisma.dayClosureSubmission.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, date: today, status: "submitted" },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assigneeId", "completed"],
      where: { assigneeId: { in: userIds }, targetDate: today, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.dayPlanSubmission.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, date: { in: weekDates } },
      _count: { _all: true },
    }),
    prisma.dayClosureSubmission.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, date: { in: weekDates }, status: "submitted" },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assigneeId", "completed"],
      where: { assigneeId: { in: userIds }, targetDate: { in: weekDates }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const consistencyByUser = new Map(consistency.map((row) => [row.user.id, row]));
  const plansTodayByUser = new Map(planCountsToday.map((r) => [r.userId, r._count._all]));
  const closuresTodayByUser = new Map(closureCountsToday.map((r) => [r.userId, r._count._all]));
  const plansWeekByUser = new Map(planCountsWeek.map((r) => [r.userId, r._count._all]));
  const closuresWeekByUser = new Map(closureCountsWeek.map((r) => [r.userId, r._count._all]));

  const tasksTodayByUser = new Map<string, { total: number; done: number }>();
  for (const r of taskCountsToday) {
    const entry = tasksTodayByUser.get(r.assigneeId) ?? { total: 0, done: 0 };
    entry.total += r._count._all;
    if (r.completed) entry.done += r._count._all;
    tasksTodayByUser.set(r.assigneeId, entry);
  }

  const tasksWeekByUser = new Map<string, { total: number; done: number }>();
  for (const r of taskCountsWeek) {
    const entry = tasksWeekByUser.get(r.assigneeId) ?? { total: 0, done: 0 };
    entry.total += r._count._all;
    if (r.completed) entry.done += r._count._all;
    tasksWeekByUser.set(r.assigneeId, entry);
  }

  return users.map((user) => {
    const todayTasks = tasksTodayByUser.get(user.id) ?? { total: 0, done: 0 };
    const weekTasks = tasksWeekByUser.get(user.id) ?? { total: 0, done: 0 };
    const plansToday = plansTodayByUser.get(user.id) ?? 0;
    const closuresToday = closuresTodayByUser.get(user.id) ?? 0;
    const plansWeek = plansWeekByUser.get(user.id) ?? 0;
    const closuresWeek = closuresWeekByUser.get(user.id) ?? 0;

    const todayKpis: Kpis = {
      activeStaffToday: 1,
      plansSubmittedToday: plansToday,
      plansSubmittedPct: plansToday > 0 ? 100 : 0,
      closuresSubmittedToday: closuresToday,
      closuresSubmittedPct: closuresToday > 0 ? 100 : 0,
      totalTasks: todayTasks.total,
      tasksDone: todayTasks.done,
      tasksDonePct: pct(todayTasks.done, todayTasks.total),
    };

    const weekKpis: Kpis = {
      activeStaffToday: 1,
      plansSubmittedToday: plansWeek,
      plansSubmittedPct: pct(plansWeek, weekDates.length),
      closuresSubmittedToday: closuresWeek,
      closuresSubmittedPct: pct(closuresWeek, weekDates.length),
      totalTasks: weekTasks.total,
      tasksDone: weekTasks.done,
      tasksDonePct: pct(weekTasks.done, weekTasks.total),
    };

    const missed =
      (consistencyByUser.get(user.id)?.planMissedDays ?? 0) +
      (consistencyByUser.get(user.id)?.closureMissedDays ?? 0);

    return { user, todayKpis, weekKpis, consistencyScore: Math.max(0, 100 - missed * 10) };
  });
}

export async function meetingsForScope(
  scope: Scope,
  query: DashboardMeetingsQuery,
): Promise<DashboardMeeting[]> {
  if (scope.type === "none") return [];
  const safeScope = requireScope(scope);
  const scopedUserIds = await userIdsInScope(safeScope);
  const date = query.date ? parseDateString(query.date) : todayInUserTz(DEFAULT_TIMEZONE);
  const { start, end } = dayBoundsInTz(date, DEFAULT_TIMEZONE);
  const meetings = await prisma.meeting.findMany({
    where: {
      deletedAt: null,
      scheduledAt: { gte: start, lte: end },
      OR: [{ userId: { in: scopedUserIds } }, { attendeeIds: { hasSome: scopedUserIds } }],
    },
    orderBy: { scheduledAt: "desc" },
  });
  return meetings.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    attendeeCount: meeting.attendeeIds.length,
    status: meeting.processedAt ? "processed" : "scheduled",
    summaryExcerpt: meeting.summary ? stripMarkdown(meeting.summary).slice(0, 180) : null,
    scheduledAt: meeting.scheduledAt.toISOString(),
    processedAt: meeting.processedAt?.toISOString() ?? null,
  }));
}

export async function assertUserInScope(scope: Scope, userId: string): Promise<void> {
  const ids = await userIdsInScope(scope);
  if (!ids.includes(userId)) throw new ForbiddenError("Target user is outside your scope");
}

export async function createDepartment(
  actor: AuthenticatedUser,
  input: CreateDepartmentInput,
): Promise<unknown> {
  if (!isOrgAdmin(actor.level)) throw new ForbiddenError("Only admins can manage departments");
  return prisma.department.create({
    data: { orgId: actor.orgId, name: input.name, headId: input.headId ?? null },
  });
}

export async function updateDepartment(
  actor: AuthenticatedUser,
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<unknown> {
  if (!isOrgAdmin(actor.level)) throw new ForbiddenError("Only admins can manage departments");
  return prisma.department.update({
    where: { id: departmentId },
    data: omitUndefined({ name: input.name, headId: input.headId }),
  });
}

async function canManageDepartment(
  actor: AuthenticatedUser,
  departmentId: string | null | undefined,
): Promise<boolean> {
  if (isOrgAdmin(actor.level)) return true;
  if (departmentId === null || departmentId === undefined) return false;
  const count = await prisma.department.count({
    where: { id: departmentId, orgId: actor.orgId, headId: actor.id },
  });
  return count > 0;
}

async function canManageGroup(actor: AuthenticatedUser, groupId: string): Promise<boolean> {
  if (isOrgAdmin(actor.level)) return true;
  const group = await prisma.contextGroup.findUnique({
    where: { id: groupId },
    select: { orgId: true, departmentId: true },
  });
  if (group?.orgId !== actor.orgId) throw new NotFoundError("Group", groupId);
  if (await canManageDepartment(actor, group.departmentId)) return true;
  const lead = await prisma.groupMembership.findFirst({
    where: { groupId, userId: actor.id, isLead: true, validTo: null },
    select: { userId: true },
  });
  return lead !== null;
}

export async function createGroup(
  actor: AuthenticatedUser,
  input: CreateGroupInput,
): Promise<unknown> {
  if (!(await canManageDepartment(actor, input.departmentId))) {
    throw new ForbiddenError("You cannot create groups in this department");
  }
  return prisma.contextGroup.create({
    data: {
      orgId: actor.orgId,
      name: input.name,
      kind: input.kind,
      departmentId: input.departmentId ?? null,
    },
  });
}

export async function updateGroup(
  actor: AuthenticatedUser,
  groupId: string,
  input: UpdateGroupInput,
): Promise<unknown> {
  if (!(await canManageGroup(actor, groupId))) throw new ForbiddenError();
  if (input.departmentId !== undefined && !(await canManageDepartment(actor, input.departmentId))) {
    throw new ForbiddenError("You cannot move this group to that department");
  }
  return prisma.contextGroup.update({
    where: { id: groupId },
    data: omitUndefined({
      name: input.name,
      kind: input.kind,
      departmentId: input.departmentId,
    }),
  });
}

export async function addGroupMember(
  actor: AuthenticatedUser,
  groupId: string,
  input: AddGroupMemberInput,
): Promise<unknown> {
  if (!(await canManageGroup(actor, groupId))) throw new ForbiddenError();
  const [group, user] = await Promise.all([
    prisma.contextGroup.findUnique({ where: { id: groupId } }),
    prisma.user.findUnique({ where: { id: input.userId } }),
  ]);
  if (!group) throw new NotFoundError("Group", groupId);
  if (user?.orgId !== actor.orgId || group.orgId !== actor.orgId) {
    throw new NotFoundError("User", input.userId);
  }
  const existing = await prisma.groupMembership.findFirst({
    where: { groupId, userId: input.userId, validTo: null },
  });
  if (existing)
    throw new AppError("GROUP_MEMBERSHIP_EXISTS", 409, "User is already active in this group");
  return prisma.groupMembership.create({
    data: {
      groupId,
      userId: input.userId,
      isLead: input.isLead ?? false,
      canManage: input.canManage ?? false,
      ...(input.reason !== undefined && { reason: input.reason }),
    },
  });
}

export async function removeGroupMember(
  actor: AuthenticatedUser,
  groupId: string,
  userId: string,
): Promise<unknown> {
  if (!(await canManageGroup(actor, groupId))) throw new ForbiddenError();
  const existing = await prisma.groupMembership.findFirst({
    where: { groupId, userId, validTo: null },
  });
  if (!existing) throw new NotFoundError("GroupMembership");
  return prisma.groupMembership.update({
    where: {
      userId_groupId_validFrom: {
        userId: existing.userId,
        groupId: existing.groupId,
        validFrom: existing.validFrom,
      },
    },
    data: { validTo: new Date() },
  });
}

/**
 * Sprint 18: flip a group membership's lead/canManage flags in place.
 * Replaces the old "remove + re-add" workaround so the membership row
 * (and its `validFrom` history) stays continuous. Uses the active row
 * (`validTo: null`) so closed memberships aren't reopened.
 */
export async function patchGroupMember(
  actor: AuthenticatedUser,
  groupId: string,
  userId: string,
  input: { isLead?: boolean | undefined; canManage?: boolean | undefined },
): Promise<unknown> {
  if (!(await canManageGroup(actor, groupId))) throw new ForbiddenError();
  const existing = await prisma.groupMembership.findFirst({
    where: { groupId, userId, validTo: null },
  });
  if (!existing) throw new NotFoundError("GroupMembership");

  // If we're promoting this user to lead, demote any other current lead so
  // the group has exactly one. Demotion of the active lead is allowed by
  // setting isLead=false explicitly on that user.
  if (input.isLead === true) {
    await prisma.groupMembership.updateMany({
      where: { groupId, validTo: null, isLead: true, NOT: { userId } },
      data: { isLead: false },
    });
  }

  return prisma.groupMembership.update({
    where: {
      userId_groupId_validFrom: {
        userId: existing.userId,
        groupId: existing.groupId,
        validFrom: existing.validFrom,
      },
    },
    data: {
      ...(input.isLead !== undefined && { isLead: input.isLead }),
      ...(input.canManage !== undefined && { canManage: input.canManage }),
    },
  });
}

export async function createReminder(
  actor: AuthenticatedUser,
  scope: Scope,
  input: CreateReminderInput,
): Promise<{ id: string; sentAt: string }> {
  await assertUserInScope(scope, input.targetUserId);
  const row = await prisma.reminderIntent.create({
    data: { targetUserId: input.targetUserId, kind: input.kind, sentBy: actor.id },
  });
  return { id: row.id, sentAt: row.sentAt.toISOString() };
}
