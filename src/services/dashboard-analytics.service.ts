import prisma from "../lib/prisma.js";
import type { Scope } from "../lib/resolve-scope.js";
import { formatDateYmd, todayInUserTz } from "../utils/date.js";

import { consistencyForUsers, userIdsInScope } from "./dashboard-rollup.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

function rangeDays(days: number, endDate = todayInUserTz(DEFAULT_TIMEZONE)): Date[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date;
  });
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

// ───────────────────────────────────────────────────────────────────────────
// PERFORMERS — top & bottom over a window of N days.
// ───────────────────────────────────────────────────────────────────────────

export interface PerformerRow {
  user: { id: string; name: string; role: string };
  value: number;
  secondary: string;
}

export interface PerformersResult {
  top: PerformerRow[];
  bottom: PerformerRow[];
  metric: "tasks" | "consistency";
  windowDays: number;
}

export async function getPerformers(
  scope: Scope,
  metric: "tasks" | "consistency",
  days: number,
  limit: number,
): Promise<PerformersResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) {
    return { top: [], bottom: [], metric, windowDays: days };
  }

  // Performers list is individual-contributor only — exclude managers and above.
  // Level is the reliable discriminator: L100 = IC, L300+ = lead/manager/admin.
  const staffRows = await prisma.user.findMany({
    where: { id: { in: userIds }, level: { lte: 100 } },
    select: { id: true },
  });
  const staffIds = staffRows.map((r) => r.id);
  if (staffIds.length === 0) {
    return { top: [], bottom: [], metric, windowDays: days };
  }

  const dates = rangeDays(days);

  if (metric === "tasks") {
    const [users, taskCounts] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, role: true },
      }),
      prisma.task.groupBy({
        by: ["assigneeId"],
        where: {
          assigneeId: { in: staffIds },
          targetDate: { in: dates },
          deletedAt: null,
          completed: true,
        },
        _count: { _all: true },
      }),
    ]);
    const doneByUser = new Map(taskCounts.map((r) => [r.assigneeId, r._count._all]));
    const rows: PerformerRow[] = users.map((u) => ({
      user: u,
      value: doneByUser.get(u.id) ?? 0,
      secondary: `${(doneByUser.get(u.id) ?? 0).toString()} tasks done · ${days.toString()}d`,
    }));
    const sortedDesc = [...rows].sort((a, b) => b.value - a.value);
    const sortedAsc = [...rows].sort((a, b) => a.value - b.value);
    return {
      metric,
      windowDays: days,
      top: sortedDesc.slice(0, limit),
      bottom: sortedAsc.slice(0, limit),
    };
  }

  // consistency: rank by lowest missed-days. Bottom = highest missed-days.
  const rows = await consistencyForUsers(staffIds, days);
  const performerRows: PerformerRow[] = rows.map((r) => {
    const missed = r.planMissedDays + r.closureMissedDays;
    const score = Math.max(0, 100 - missed * 10);
    return {
      user: { id: r.user.id, name: r.user.name, role: r.user.role },
      value: score,
      secondary:
        missed === 0
          ? `${days.toString()}d perfect`
          : `missed ${r.planMissedDays.toString()}/${days.toString()} plans, ${r.closureMissedDays.toString()}/${days.toString()} EODs`,
    };
  });
  const sortedDesc = [...performerRows].sort((a, b) => b.value - a.value);
  const sortedAsc = [...performerRows].sort((a, b) => a.value - b.value);
  return {
    metric,
    windowDays: days,
    top: sortedDesc.slice(0, limit),
    bottom: sortedAsc.slice(0, limit),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PLAN vs CLOSURE — per-day bar chart series + assigned/closed totals.
// ───────────────────────────────────────────────────────────────────────────

export interface PlanVsClosurePoint {
  date: string;
  plansSubmitted: number;
  closuresSubmitted: number;
  totalUsers: number;
}

export interface PlanVsClosureResult {
  series: PlanVsClosurePoint[];
  assignedTotal: number;
  closedTotal: number;
  windowDays: number;
}

export async function getPlanVsClosure(scope: Scope, days: number): Promise<PlanVsClosureResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) {
    return { series: [], assignedTotal: 0, closedTotal: 0, windowDays: days };
  }
  const dates = rangeDays(days);

  const [plans, closures, taskRows] = await Promise.all([
    prisma.dayPlanSubmission.findMany({
      where: { userId: { in: userIds }, date: { in: dates } },
      select: { userId: true, date: true },
    }),
    prisma.dayClosureSubmission.findMany({
      // Sprint 17 Phase 5 alignment.
      where: { userId: { in: userIds }, date: { in: dates }, status: "submitted" },
      select: { userId: true, date: true },
    }),
    prisma.task.groupBy({
      by: ["completed"],
      where: {
        assigneeId: { in: userIds },
        targetDate: { in: dates },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const planKeys = new Map<string, number>();
  for (const p of plans) {
    const k = formatDateYmd(p.date);
    planKeys.set(k, (planKeys.get(k) ?? 0) + 1);
  }
  const closureKeys = new Map<string, number>();
  for (const c of closures) {
    const k = formatDateYmd(c.date);
    closureKeys.set(k, (closureKeys.get(k) ?? 0) + 1);
  }

  const series = dates.map((d) => {
    const key = formatDateYmd(d);
    return {
      date: key,
      plansSubmitted: planKeys.get(key) ?? 0,
      closuresSubmitted: closureKeys.get(key) ?? 0,
      totalUsers: userIds.length,
    };
  });

  const assignedTotal = taskRows.reduce((sum, r) => sum + r._count._all, 0);
  const closedTotal = taskRows
    .filter((r) => r.completed)
    .reduce((sum, r) => sum + r._count._all, 0);

  return { series, assignedTotal, closedTotal, windowDays: days };
}

// ───────────────────────────────────────────────────────────────────────────
// SUMMARY CARDS — the four hero numbers (total tasks / done / meetings this
// week / total employees). All scope-filtered.
// ───────────────────────────────────────────────────────────────────────────

export interface SummaryCardsResult {
  totalTasks: number;
  tasksDone: number;
  meetingsThisWeek: number;
  totalEmployees: number;
  staffOnLeaveToday: number;
}

export async function getSummaryCards(scope: Scope): Promise<SummaryCardsResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) {
    return {
      totalTasks: 0,
      tasksDone: 0,
      meetingsThisWeek: 0,
      totalEmployees: 0,
      staffOnLeaveToday: 0,
    };
  }
  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

  const [taskCounts, meetingCount, leaveCount] = await Promise.all([
    prisma.task.groupBy({
      by: ["completed"],
      where: {
        assigneeId: { in: userIds },
        targetDate: today,
        deletedAt: null,
      },
      _count: { _all: true },
    }),
    prisma.meeting.count({
      where: {
        deletedAt: null,
        scheduledAt: { gte: startOfDay(weekAgo), lte: endOfDay(today) },
        OR: [{ userId: { in: userIds } }, { attendeeIds: { hasSome: userIds } }],
      },
    }),
    // A4: count staff with an approved holiday record for today.
    prisma.holiday.count({ where: { userId: { in: userIds }, date: today } }),
  ]);
  const totalTasks = taskCounts.reduce((sum, r) => sum + r._count._all, 0);
  const tasksDone = taskCounts
    .filter((r) => r.completed)
    .reduce((sum, r) => sum + r._count._all, 0);

  return {
    totalTasks,
    tasksDone,
    meetingsThisWeek: meetingCount,
    totalEmployees: userIds.length,
    staffOnLeaveToday: leaveCount,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// TASK FLOW — daily inflow (created) vs outflow (completed) over N days.
// ───────────────────────────────────────────────────────────────────────────

export interface TaskFlowPoint {
  date: string;
  created: number;
  completed: number;
}

export interface TaskFlowResult {
  series: TaskFlowPoint[];
  netFlow: number;
  windowDays: number;
}

export async function getTaskFlow(scope: Scope, days: number): Promise<TaskFlowResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return { series: [], netFlow: 0, windowDays: days };

  const dates = rangeDays(days);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  if (!firstDate || !lastDate) return { series: [], netFlow: 0, windowDays: days };
  const rangeStart = startOfDay(firstDate);
  const rangeEnd = endOfDay(lastDate);

  const [createdTasks, completedRows] = await Promise.all([
    // Inflow: tasks assigned to scoped users, created within the window.
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        createdAt: { gte: rangeStart, lte: rangeEnd },
        deletedAt: null,
      },
      select: { createdAt: true },
    }),
    // Outflow: tasks targeted on each date in the window that are completed.
    prisma.task.groupBy({
      by: ["targetDate"],
      where: {
        assigneeId: { in: userIds },
        targetDate: { in: dates },
        completed: true,
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const createdByDate = new Map<string, number>();
  for (const t of createdTasks) {
    const k = formatDateYmd(t.createdAt);
    createdByDate.set(k, (createdByDate.get(k) ?? 0) + 1);
  }
  const completedByDate = new Map(
    completedRows.map((r) => [formatDateYmd(r.targetDate), r._count._all]),
  );

  const series = dates.map((d) => {
    const key = formatDateYmd(d);
    return {
      date: key,
      created: createdByDate.get(key) ?? 0,
      completed: completedByDate.get(key) ?? 0,
    };
  });

  const totalCreated = series.reduce((s, p) => s + p.created, 0);
  const totalCompleted = series.reduce((s, p) => s + p.completed, 0);

  return { series, netFlow: totalCompleted - totalCreated, windowDays: days };
}

// ───────────────────────────────────────────────────────────────────────────
// PRIORITY BREAKDOWN — today's task count split by priority level.
// ───────────────────────────────────────────────────────────────────────────

export interface PriorityBreakdownPoint {
  priority: "high" | "medium" | "low" | "none";
  count: number;
}

export interface PriorityBreakdownResult {
  series: PriorityBreakdownPoint[];
  total: number;
}

export async function getPriorityBreakdown(scope: Scope): Promise<PriorityBreakdownResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return { series: [], total: 0 };

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const rows = await prisma.task.groupBy({
    by: ["priority"],
    where: { assigneeId: { in: userIds }, targetDate: today, deletedAt: null },
    _count: { _all: true },
  });

  const series: PriorityBreakdownPoint[] = rows.map((r) => ({
    priority: r.priority !== null ? (r.priority as "high" | "medium" | "low") : "none",
    count: r._count._all,
  }));
  const total = series.reduce((s, p) => s + p.count, 0);
  return { series, total };
}

// ───────────────────────────────────────────────────────────────────────────
// OVERDUE TASKS — tasks past their targetDate, not completed, within scope.
// ───────────────────────────────────────────────────────────────────────────

export interface OverdueTaskRow {
  id: string;
  title: string;
  priority: "high" | "medium" | "low" | null;
  daysOverdue: number;
  assignee: { id: string; name: string; role: string };
}

export interface OverdueResult {
  tasks: OverdueTaskRow[];
  total: number;
}

export async function getOverdueTasks(scope: Scope, limit = 20): Promise<OverdueResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return { tasks: [], total: 0 };

  const today = todayInUserTz(DEFAULT_TIMEZONE);

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        targetDate: { lt: today },
        completed: false,
        deletedAt: null,
      },
      orderBy: { targetDate: "asc" },
      take: limit,
      select: {
        id: true,
        title: true,
        priority: true,
        targetDate: true,
        assignee: { select: { id: true, name: true, role: true } },
      },
    }),
    prisma.task.count({
      where: {
        assigneeId: { in: userIds },
        targetDate: { lt: today },
        completed: false,
        deletedAt: null,
      },
    }),
  ]);

  const todayMs = today.getTime();
  const MS_PER_DAY = 86_400_000;

  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority as "high" | "medium" | "low" | null,
      daysOverdue: Math.max(1, Math.floor((todayMs - t.targetDate.getTime()) / MS_PER_DAY)),
      assignee: t.assignee,
    })),
    total,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// GROUP-WISE ANALYTICS — assigned vs closed per group within scope.
// ───────────────────────────────────────────────────────────────────────────

export interface GroupAnalyticsRow {
  group: { id: string; name: string; kind: string; departmentName: string | null };
  activeStaff: number;
  assignedToday: number;
  closedToday: number;
  donePct: number;
}

export async function getGroupAnalytics(scope: Scope): Promise<GroupAnalyticsRow[]> {
  if (scope.type === "none") return [];
  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const scopedIds = new Set(await userIdsInScope(scope));

  const groups = await prisma.contextGroup.findMany({
    where: {
      orgId: scope.orgId,
      kind: { not: "personal" },
      ...(scope.type === "org"
        ? {}
        : scope.type === "dept"
          ? { departmentId: { in: scope.departmentIds } }
          : scope.type === "group"
            ? { id: { in: scope.groupIds } }
            : {
                memberships: {
                  some: {
                    userId: { in: scope.reportIds },
                    validTo: null,
                  },
                },
              }),
    },
    include: {
      department: { select: { name: true } },
      memberships: { where: { validTo: null }, select: { userId: true } },
    },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    groups.map(async (group) => {
      const memberIds = group.memberships.map((m) => m.userId);
      const scopedMemberIds = memberIds.filter((id) => scopedIds.has(id));
      let assignedToday = 0;
      let closedToday = 0;
      if (scopedMemberIds.length > 0) {
        const taskRows = await prisma.task.groupBy({
          by: ["completed"],
          where: {
            assigneeId: { in: scopedMemberIds },
            targetDate: today,
            deletedAt: null,
          },
          _count: { _all: true },
        });
        assignedToday = taskRows.reduce((sum, r) => sum + r._count._all, 0);
        closedToday = taskRows
          .filter((r) => r.completed)
          .reduce((sum, r) => sum + r._count._all, 0);
      }
      const donePct =
        assignedToday === 0 ? 0 : Math.round((closedToday / assignedToday) * 1000) / 10;
      return {
        group: {
          id: group.id,
          name: group.name,
          kind: group.kind,
          departmentName: group.department?.name ?? null,
        },
        activeStaff: scopedMemberIds.length,
        assignedToday,
        closedToday,
        donePct,
      };
    }),
  );
}
