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
// SUBMISSIONS TODAY — A3 plan timing (on-time vs late) + A8 closure status.
// "Late" = plan submitted after 12 PM IST (06:30 UTC).
// ───────────────────────────────────────────────────────────────────────────

// 12:00 PM IST == 06:30 UTC (IST = UTC+5:30).
const PLAN_CUTOFF_UTC = { hour: 6, minute: 30 } as const;

function isPlanOnTime(submittedAt: Date): boolean {
  const h = submittedAt.getUTCHours();
  const m = submittedAt.getUTCMinutes();
  return h < PLAN_CUTOFF_UTC.hour || (h === PLAN_CUTOFF_UTC.hour && m <= PLAN_CUTOFF_UTC.minute);
}

export interface SubmissionsTodayResult {
  plans: { onTime: number; late: number; notSubmitted: number; totalUsers: number };
  closures: { submitted: number; inDraft: number; notStarted: number; totalUsers: number };
}

export async function getSubmissionsToday(scope: Scope): Promise<SubmissionsTodayResult> {
  const userIds = await userIdsInScope(scope);
  const totalUsers = userIds.length;
  if (totalUsers === 0) {
    return {
      plans: { onTime: 0, late: 0, notSubmitted: 0, totalUsers: 0 },
      closures: { submitted: 0, inDraft: 0, notStarted: 0, totalUsers: 0 },
    };
  }

  const today = todayInUserTz(DEFAULT_TIMEZONE);

  const [planRows, closureRows] = await Promise.all([
    prisma.dayPlanSubmission.findMany({
      where: { userId: { in: userIds }, date: today },
      select: { submittedAt: true },
    }),
    prisma.dayClosureSubmission.findMany({
      where: { userId: { in: userIds }, date: today },
      select: { status: true },
    }),
  ]);

  let onTime = 0;
  let late = 0;
  for (const p of planRows) {
    if (isPlanOnTime(p.submittedAt)) onTime++;
    else late++;
  }

  let submitted = 0;
  let inDraft = 0;
  for (const c of closureRows) {
    if (c.status === "submitted") submitted++;
    else inDraft++;
  }

  return {
    plans: { onTime, late, notSubmitted: totalUsers - planRows.length, totalUsers },
    closures: { submitted, inDraft, notStarted: totalUsers - closureRows.length, totalUsers },
  };
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
// PLAN ACCURACY — % of planned tasks (from DayPlanSubmission snapshots) that
// ended up completed, per day over N days.
// ───────────────────────────────────────────────────────────────────────────

export interface PlanAccuracyPoint {
  date: string;
  planned: number;
  completed: number;
  accuracy: number;
}

export interface PlanAccuracyResult {
  series: PlanAccuracyPoint[];
  avgAccuracy: number;
  windowDays: number;
}

export async function getPlanAccuracy(scope: Scope, days: number): Promise<PlanAccuracyResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return { series: [], avgAccuracy: 0, windowDays: days };

  const dates = rangeDays(days);

  const submissions = await prisma.dayPlanSubmission.findMany({
    where: { userId: { in: userIds }, date: { in: dates } },
    select: { date: true, taskSnapshot: true },
  });

  // Group snapshot task IDs by date — only entries that carry an id field.
  const snapshotIdsByDate = new Map<string, string[]>();
  for (const sub of submissions) {
    const key = formatDateYmd(sub.date);
    const snapshot = sub.taskSnapshot as { id?: unknown }[];
    const ids = snapshot.map((s) => s.id).filter((id): id is string => typeof id === "string");
    const existing = snapshotIdsByDate.get(key) ?? [];
    snapshotIdsByDate.set(key, [...existing, ...ids]);
  }

  const allTaskIds = [...snapshotIdsByDate.values()].flat();
  const completedIds = new Set<string>();
  if (allTaskIds.length > 0) {
    const completedTasks = await prisma.task.findMany({
      where: { id: { in: allTaskIds }, completed: true, deletedAt: null },
      select: { id: true },
    });
    for (const t of completedTasks) completedIds.add(t.id);
  }

  const series = dates.map((d) => {
    const key = formatDateYmd(d);
    const ids = snapshotIdsByDate.get(key) ?? [];
    const planned = ids.length;
    const completed = ids.filter((id) => completedIds.has(id)).length;
    const accuracy = planned === 0 ? 0 : Math.round((completed / planned) * 100);
    return { date: key, planned, completed, accuracy };
  });

  const daysWithData = series.filter((p) => p.planned > 0);
  const avgAccuracy =
    daysWithData.length === 0
      ? 0
      : Math.round(daysWithData.reduce((s, p) => s + p.accuracy, 0) / daysWithData.length);

  return { series, avgAccuracy, windowDays: days };
}

// ───────────────────────────────────────────────────────────────────────────
// MEETING CONVERSION — completion rate of meeting-sourced tasks vs others.
// ───────────────────────────────────────────────────────────────────────────

export interface MeetingConversionBucket {
  total: number;
  done: number;
  pct: number;
}

export interface MeetingConversionResult {
  meetingTasks: MeetingConversionBucket;
  otherTasks: MeetingConversionBucket;
  windowDays: number;
}

function toPct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export async function getMeetingConversion(
  scope: Scope,
  days: number,
): Promise<MeetingConversionResult> {
  const userIds = await userIdsInScope(scope);
  const empty: MeetingConversionResult = {
    meetingTasks: { total: 0, done: 0, pct: 0 },
    otherTasks: { total: 0, done: 0, pct: 0 },
    windowDays: days,
  };
  if (userIds.length === 0) return empty;

  const dates = rangeDays(days);

  const [meetingRows, otherRows] = await Promise.all([
    prisma.task.groupBy({
      by: ["completed"],
      where: {
        assigneeId: { in: userIds },
        sourceType: "meeting",
        targetDate: { in: dates },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["completed"],
      where: {
        assigneeId: { in: userIds },
        sourceType: { not: "meeting" },
        targetDate: { in: dates },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const meetTotal = meetingRows.reduce((s, r) => s + r._count._all, 0);
  const meetDone = meetingRows.filter((r) => r.completed).reduce((s, r) => s + r._count._all, 0);
  const otherTotal = otherRows.reduce((s, r) => s + r._count._all, 0);
  const otherDone = otherRows.filter((r) => r.completed).reduce((s, r) => s + r._count._all, 0);

  return {
    meetingTasks: { total: meetTotal, done: meetDone, pct: toPct(meetDone, meetTotal) },
    otherTasks: { total: otherTotal, done: otherDone, pct: toPct(otherDone, otherTotal) },
    windowDays: days,
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

// ───────────────────────────────────────────────────────────────────────────
// MEETINGS ANALYTICS — daily meeting count + action items generated.
// ───────────────────────────────────────────────────────────────────────────

export interface MeetingsDailyPoint {
  date: string;
  count: number;
  actionItemCount: number;
}

export interface MeetingsAnalyticsResult {
  series: MeetingsDailyPoint[];
  windowDays: number;
  totalMeetings: number;
  totalActionItems: number;
  processed: number;
}

export async function getMeetingsAnalytics(
  scope: Scope,
  days: number,
): Promise<MeetingsAnalyticsResult> {
  const userIds = await userIdsInScope(scope);
  const dates = rangeDays(days);
  const empty: MeetingsAnalyticsResult = {
    series: dates.map((d) => ({ date: formatDateYmd(d), count: 0, actionItemCount: 0 })),
    windowDays: days,
    totalMeetings: 0,
    totalActionItems: 0,
    processed: 0,
  };
  if (userIds.length === 0) return empty;

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const from = startOfDay(dates[0] ?? today);
  const to = endOfDay(dates[dates.length - 1] ?? today);

  const meetings = await prisma.meeting.findMany({
    where: {
      deletedAt: null,
      scheduledAt: { gte: from, lte: to },
      OR: [{ userId: { in: userIds } }, { attendeeIds: { hasSome: userIds } }],
    },
    select: { scheduledAt: true, processedAt: true, actions: true },
  });

  const byDate = new Map<string, { count: number; actionItemCount: number }>();
  for (const d of dates) byDate.set(formatDateYmd(d), { count: 0, actionItemCount: 0 });

  let totalActionItems = 0;
  let processed = 0;

  for (const m of meetings) {
    const key = formatDateYmd(m.scheduledAt);
    const entry = byDate.get(key);
    if (!entry) continue;
    entry.count += 1;
    if (m.processedAt) {
      const actionCount = Array.isArray(m.actions) ? m.actions.length : 0;
      entry.actionItemCount += actionCount;
      totalActionItems += actionCount;
      processed += 1;
    }
  }

  const series = dates.map((d) => ({
    date: formatDateYmd(d),
    ...(byDate.get(formatDateYmd(d)) ?? { count: 0, actionItemCount: 0 }),
  }));

  return {
    series,
    windowDays: days,
    totalMeetings: meetings.length,
    totalActionItems,
    processed,
  };
}
