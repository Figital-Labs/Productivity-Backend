import prisma from "../lib/prisma.js";
import type { Scope } from "../lib/resolve-scope.js";
import {
  dayBoundsInTz,
  extractHourInTimezone,
  formatDateYmd,
  parseDateString,
  todayInUserTz,
} from "../utils/date.js";

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

// Builds the unsorted per-staff performer rows for a scope + metric + window.
// Shared by the top-N widget (`getPerformers`) and the full paginated
// leaderboard (`getPerformersRanking`) so ranking semantics never drift.
async function performerRows(
  scope: Scope,
  metric: "tasks" | "consistency",
  days: number,
): Promise<PerformerRow[]> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return [];

  // Performers list is individual-contributor only — exclude managers and above.
  // Level is the reliable discriminator: L100 = IC, L300+ = lead/manager/admin.
  const staffRows = await prisma.user.findMany({
    where: { id: { in: userIds }, level: { lte: 100 } },
    select: { id: true },
  });
  const staffIds = staffRows.map((r) => r.id);
  if (staffIds.length === 0) return [];

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
    return users.map((u) => ({
      user: u,
      value: doneByUser.get(u.id) ?? 0,
      secondary: `${(doneByUser.get(u.id) ?? 0).toString()} tasks done · ${days.toString()}d`,
    }));
  }

  // consistency: score by lowest missed-days.
  const rows = await consistencyForUsers(staffIds, days);
  return rows.map((r) => {
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
}

// `id` tiebreaker → a deterministic total order, so the top-N widget and the
// paginated leaderboard rank ties identically and offset pages never overlap.
const byValueDesc = (a: PerformerRow, b: PerformerRow): number =>
  b.value - a.value || a.user.id.localeCompare(b.user.id);
const byValueAsc = (a: PerformerRow, b: PerformerRow): number =>
  a.value - b.value || a.user.id.localeCompare(b.user.id);

export async function getPerformers(
  scope: Scope,
  metric: "tasks" | "consistency",
  days: number,
  limit: number,
): Promise<PerformersResult> {
  const rows = await performerRows(scope, metric, days);
  const sortedDesc = [...rows].sort(byValueDesc);
  const sortedAsc = [...rows].sort(byValueAsc);
  return {
    metric,
    windowDays: days,
    top: sortedDesc.slice(0, limit),
    bottom: sortedAsc.slice(0, limit),
  };
}

export interface PerformersRankingResult {
  rows: PerformerRow[];
  total: number;
  hasMore: boolean;
  metric: "tasks" | "consistency";
  windowDays: number;
}

// Full ranked leaderboard in one direction, paginated. Backs the "View all"
// drill-down from the top-N PerformersPanel widget.
export async function getPerformersRanking(
  scope: Scope,
  metric: "tasks" | "consistency",
  days: number,
  order: "top" | "bottom",
  limit: number,
  offset: number,
): Promise<PerformersRankingResult> {
  const rows = await performerRows(scope, metric, days);
  const sorted = order === "bottom" ? [...rows].sort(byValueAsc) : [...rows].sort(byValueDesc);
  const page = sorted.slice(offset, offset + limit);
  return {
    rows: page,
    total: sorted.length,
    hasMore: offset + page.length < sorted.length,
    metric,
    windowDays: days,
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
  assignee: { id: string; name: string; role: string; designation: string | null };
}

export interface OverdueResult {
  tasks: OverdueTaskRow[];
  total: number;
  hasMore: boolean;
}

export async function getOverdueTasks(
  scope: Scope,
  limit = 20,
  offset = 0,
): Promise<OverdueResult> {
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return { tasks: [], total: 0, hasMore: false };

  const today = todayInUserTz(DEFAULT_TIMEZONE);

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        targetDate: { lt: today },
        completed: false,
        deletedAt: null,
      },
      // `id` tiebreaker makes the order a deterministic total order so
      // skip/take pages never overlap or drop tasks tied on targetDate.
      orderBy: [{ targetDate: "asc" }, { id: "asc" }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        priority: true,
        targetDate: true,
        assignee: { select: { id: true, name: true, role: true, designation: true } },
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
    hasMore: offset + tasks.length < total,
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

// ───────────────────────────────────────────────────────────────────────────
// Sprint 21 — department rollup helper. Maps each user to a single "primary"
// department (first group membership, ordered deterministically). Used to roll
// scheduling insights up by department so the manager dashboard stays legible
// at 100+ people. Users with no department land in the "__none__" bucket.
// ───────────────────────────────────────────────────────────────────────────

const UNASSIGNED_DEPT = "__none__";
const NO_DEPT_LABEL = "No department";

async function departmentMapForUsers(
  orgId: string,
  userIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (userIds.length === 0) return out;

  const memberships = await prisma.groupMembership.findMany({
    where: { validTo: null, userId: { in: userIds }, group: { orgId } },
    select: { userId: true, group: { select: { departmentId: true } } },
    orderBy: [{ validFrom: "asc" }, { groupId: "asc" }],
  });

  const deptIds = [
    ...new Set(
      memberships
        .map((m) => m.group.departmentId)
        .filter((id): id is string => id !== null && id !== ""),
    ),
  ];
  const depts =
    deptIds.length > 0
      ? await prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : [];
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  for (const m of memberships) {
    if (out.has(m.userId)) continue; // first membership wins → stable primary dept
    const did = m.group.departmentId;
    if (did !== null && did !== "" && deptName.has(did)) {
      out.set(m.userId, { id: did, name: deptName.get(did) ?? NO_DEPT_LABEL });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Sprint 20/21 — SCHEDULE HEATMAP — when is the team busy on a given day.
// Top level returns a team availability CURVE (how many people are busy each
// hour) — one row, scales to any headcount. Pass a departmentId to drill into
// that team's per-person grid. Buckets each task's minutes into the hour(s) it
// spans.
// ───────────────────────────────────────────────────────────────────────────

const SLOT_DEFAULT_DURATION = 30;

export interface HeatmapCell {
  userId: string;
  hour: number; // hour-of-day (0–23)
  scheduledMin: number;
  taskCount: number;
}

export interface HeatmapBusyHour {
  hour: number; // hour-of-day (0–23)
  peopleBusy: number; // distinct people with a scheduled task overlapping this hour
  scheduledMin: number; // total minutes booked across the team this hour
}

export interface HeatmapDeptRef {
  id: string; // department id, or "__none__"
  name: string;
  userCount: number; // people in this dept with scheduled work today
}

export interface ScheduleHeatmapResult {
  busyByHour: HeatmapBusyHour[]; // team availability curve (always present)
  departments: HeatmapDeptRef[]; // drill-down selector options
  totalUsers: number; // people in scope with scheduled work today
  // Per-person grid — populated ONLY when a departmentId is requested, so the
  // payload stays bounded (one team) instead of all 100+ people at once.
  users: { id: string; name: string }[];
  hourStart: number; // first hour column (inclusive)
  hourEnd: number; // last hour column (inclusive)
  cells: HeatmapCell[];
  date: string;
}

export async function getScheduleHeatmap(
  scope: Scope,
  dateStr: string | undefined,
  departmentId?: string,
): Promise<ScheduleHeatmapResult> {
  const date = dateStr ? parseDateString(dateStr) : todayInUserTz(DEFAULT_TIMEZONE);
  const dateOut = formatDateYmd(date);
  const empty: ScheduleHeatmapResult = {
    busyByHour: [],
    departments: [],
    totalUsers: 0,
    users: [],
    hourStart: 9,
    hourEnd: 17,
    cells: [],
    date: dateOut,
  };

  if (scope.type === "none") return empty;
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return empty;

  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: userIds },
      targetDate: date,
      deletedAt: null,
      scheduledStartMinute: { not: null },
    },
    select: { assigneeId: true, scheduledStartMinute: true, scheduledDurationMinutes: true },
  });
  if (tasks.length === 0) return empty;

  const presentIds = [...new Set(tasks.map((t) => t.assigneeId))];
  const deptMap = await departmentMapForUsers(scope.orgId, presentIds);

  // Department selector options — derived from people who actually have work.
  const deptBucket = new Map<string, { name: string; users: Set<string> }>();
  for (const id of presentIds) {
    const dept = deptMap.get(id);
    const key = dept?.id ?? UNASSIGNED_DEPT;
    const bucket = deptBucket.get(key) ?? { name: dept?.name ?? NO_DEPT_LABEL, users: new Set() };
    bucket.users.add(id);
    deptBucket.set(key, bucket);
  }
  const departments: HeatmapDeptRef[] = [...deptBucket.entries()]
    .map(([id, b]) => ({ id, name: b.name, userCount: b.users.size }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per-(user, hour) minutes across the whole scope — the source for the curve.
  const cellMap = new Map<string, HeatmapCell>();
  let minStart = 24 * 60;
  let maxEnd = 0;
  for (const t of tasks) {
    const start = t.scheduledStartMinute;
    if (start === null) continue;
    const end = start + (t.scheduledDurationMinutes ?? SLOT_DEFAULT_DURATION);
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, end);
    let m = start;
    while (m < end) {
      const hour = Math.floor(m / 60);
      const segEnd = Math.min(end, (hour + 1) * 60);
      const key = `${t.assigneeId}:${hour.toString()}`;
      const cell = cellMap.get(key) ?? {
        userId: t.assigneeId,
        hour,
        scheduledMin: 0,
        taskCount: 0,
      };
      cell.scheduledMin += segEnd - m;
      cell.taskCount += 1;
      cellMap.set(key, cell);
      m = segEnd;
    }
  }

  const hourStart = Math.floor(minStart / 60);
  const hourEnd = Math.floor((maxEnd - 1) / 60);

  // Collapse the per-person cells into the team availability curve.
  const hourAgg = new Map<number, { people: Set<string>; min: number }>();
  for (const cell of cellMap.values()) {
    const h = hourAgg.get(cell.hour) ?? { people: new Set(), min: 0 };
    h.people.add(cell.userId);
    h.min += cell.scheduledMin;
    hourAgg.set(cell.hour, h);
  }
  const busyByHour: HeatmapBusyHour[] = [];
  for (let hour = hourStart; hour <= hourEnd; hour += 1) {
    const agg = hourAgg.get(hour);
    busyByHour.push({
      hour,
      peopleBusy: agg?.people.size ?? 0,
      scheduledMin: agg?.min ?? 0,
    });
  }

  // Drill-down grid — only when a department is selected, bounded to that team.
  let users: { id: string; name: string }[] = [];
  let cells: HeatmapCell[] = [];
  if (departmentId !== undefined) {
    const deptUserIds = presentIds.filter(
      (id) => (deptMap.get(id)?.id ?? UNASSIGNED_DEPT) === departmentId,
    );
    if (deptUserIds.length > 0) {
      const deptUserSet = new Set(deptUserIds);
      users = await prisma.user.findMany({
        where: { id: { in: deptUserIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      cells = [...cellMap.values()].filter((c) => deptUserSet.has(c.userId));
    }
  }

  return {
    busyByHour,
    departments,
    totalUsers: presentIds.length,
    users,
    hourStart,
    hourEnd,
    cells,
    date: dateOut,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Sprint 20 — SCHEDULE ADHERENCE — did people do what they scheduled, on time?
// "on time" = a scheduled task completed on the SAME local day it was planned
// for (uses `completedAt` vs the target day's bounds — robust to batch EOD
// completion at the minute level).
// ───────────────────────────────────────────────────────────────────────────

export interface AdherenceRow {
  user: { id: string; name: string; role: string };
  departmentName: string | null;
  scheduled: number;
  completed: number;
  onTime: number;
}

export interface AdherenceDeptRow {
  id: string; // department id, or "__none__"
  name: string;
  userCount: number;
  scheduled: number;
  completed: number;
  onTime: number;
}

export interface ScheduleAdherenceResult {
  summary: { scheduled: number; completed: number; onTime: number; userCount: number };
  departments: AdherenceDeptRow[]; // per-dept rollup, worst adherence first
  rows: AdherenceRow[]; // per-person, worst first, capped (see ADHERENCE_ROW_CAP)
  totalUsers: number; // people with scheduled work (rows may be capped below this)
  trend: { date: string; scheduled: number; completed: number }[];
  windowDays: number;
}

// At 100+ people we never ship the whole roster to the client; the panel leads
// with the rollup + worst outliers and lets the manager search within this cap.
const ADHERENCE_ROW_CAP = 200;

export async function getScheduleAdherence(
  scope: Scope,
  days: number,
): Promise<ScheduleAdherenceResult> {
  const dates = rangeDays(days);
  const emptyTrend = dates.map((d) => ({ date: formatDateYmd(d), scheduled: 0, completed: 0 }));
  const empty: ScheduleAdherenceResult = {
    summary: { scheduled: 0, completed: 0, onTime: 0, userCount: 0 },
    departments: [],
    rows: [],
    totalUsers: 0,
    trend: emptyTrend,
    windowDays: days,
  };

  if (scope.type === "none") return empty;
  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) return empty;

  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: userIds },
      targetDate: { in: dates },
      deletedAt: null,
      scheduledStartMinute: { not: null },
    },
    select: { assigneeId: true, targetDate: true, completed: true, completedAt: true },
  });
  if (tasks.length === 0) return empty;

  const presentIds = [...new Set(tasks.map((t) => t.assigneeId))];
  const [users, deptMap] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: presentIds } },
      select: { id: true, name: true, role: true },
    }),
    departmentMapForUsers(scope.orgId, presentIds),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const agg = new Map<string, { scheduled: number; completed: number; onTime: number }>();
  const trendMap = new Map<string, { scheduled: number; completed: number }>();
  for (const t of tasks) {
    const a = agg.get(t.assigneeId) ?? { scheduled: 0, completed: 0, onTime: 0 };
    a.scheduled += 1;
    if (t.completed) {
      a.completed += 1;
      if (t.completedAt) {
        const { start, end } = dayBoundsInTz(t.targetDate, DEFAULT_TIMEZONE);
        if (t.completedAt >= start && t.completedAt <= end) a.onTime += 1;
      }
    }
    agg.set(t.assigneeId, a);

    const ymd = formatDateYmd(t.targetDate);
    const tr = trendMap.get(ymd) ?? { scheduled: 0, completed: 0 };
    tr.scheduled += 1;
    if (t.completed) tr.completed += 1;
    trendMap.set(ymd, tr);
  }

  // Scope-wide summary — the single number a manager reads first.
  const summary = { scheduled: 0, completed: 0, onTime: 0, userCount: agg.size };
  for (const a of agg.values()) {
    summary.scheduled += a.scheduled;
    summary.completed += a.completed;
    summary.onTime += a.onTime;
  }

  // Per-department rollup — which team is lagging.
  const deptAgg = new Map<
    string,
    { name: string; scheduled: number; completed: number; onTime: number; users: Set<string> }
  >();
  for (const [id, a] of agg) {
    const dept = deptMap.get(id);
    const key = dept?.id ?? UNASSIGNED_DEPT;
    const d = deptAgg.get(key) ?? {
      name: dept?.name ?? NO_DEPT_LABEL,
      scheduled: 0,
      completed: 0,
      onTime: 0,
      users: new Set(),
    };
    d.scheduled += a.scheduled;
    d.completed += a.completed;
    d.onTime += a.onTime;
    d.users.add(id);
    deptAgg.set(key, d);
  }
  const departments: AdherenceDeptRow[] = [...deptAgg.entries()]
    .map(([id, d]) => ({
      id,
      name: d.name,
      userCount: d.users.size,
      scheduled: d.scheduled,
      completed: d.completed,
      onTime: d.onTime,
    }))
    .sort((x, y) => x.completed / x.scheduled - y.completed / y.scheduled);

  const rows: AdherenceRow[] = [...agg.entries()]
    .map(([id, a]) => ({
      user: userMap.get(id) ?? { id, name: "Unknown", role: "staff" },
      departmentName: deptMap.get(id)?.name ?? null,
      scheduled: a.scheduled,
      completed: a.completed,
      onTime: a.onTime,
    }))
    .sort((x, y) => x.completed / x.scheduled - y.completed / y.scheduled) // worst adherence first
    .slice(0, ADHERENCE_ROW_CAP);

  const trend = dates.map((d) => {
    const ymd = formatDateYmd(d);
    const tr = trendMap.get(ymd) ?? { scheduled: 0, completed: 0 };
    return { date: ymd, scheduled: tr.scheduled, completed: tr.completed };
  });

  return { summary, departments, rows, totalUsers: agg.size, trend, windowDays: days };
}

// ───────────────────────────────────────────────────────────────────────────
// PRODUCTIVE HOURS — when the team actually completes work, bucketed by the hour
// of day on each user's OWN clock. Twin to the schedule heatmap, but driven by
// `completedAt` (real throughput) rather than scheduled slots. Aggregate and
// timezone-correct by construction; deliberately NOT per-person (team insight,
// "when does work ship", not individual surveillance).
// ───────────────────────────────────────────────────────────────────────────

export interface ProductiveHourBucket {
  hour: number; // 0–23, on the completing user's local clock
  completedCount: number; // tasks completed in this hour across the team + window
  peopleCompleted: number; // distinct people who completed ≥1 task in this hour
}

export interface ProductiveHoursResult {
  byHour: ProductiveHourBucket[]; // always 24 entries → stable chart axis
  totalCompleted: number;
  peakHour: number | null; // busiest completion hour, or null when there's no data
  windowDays: number;
}

export async function getProductiveHours(
  scope: Scope,
  days: number,
): Promise<ProductiveHoursResult> {
  const byHourEmpty = (): ProductiveHourBucket[] =>
    Array.from({ length: 24 }, (_, hour) => ({ hour, completedCount: 0, peopleCompleted: 0 }));

  const userIds = await userIdsInScope(scope);
  if (userIds.length === 0) {
    return { byHour: byHourEmpty(), totalCompleted: 0, peakHour: null, windowDays: days };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, timezone: true },
  });
  const tzMap = new Map(users.map((u) => [u.id, u.timezone]));

  const end = todayInUserTz(DEFAULT_TIMEZONE);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: userIds },
      targetDate: { gte: startOfDay(start), lte: endOfDay(end) },
      completed: true,
      completedAt: { not: null },
      deletedAt: null,
    },
    select: { assigneeId: true, completedAt: true },
  });

  const agg = new Map<number, { count: number; people: Set<string> }>();
  for (const t of tasks) {
    if (t.completedAt === null) continue;
    const tz = tzMap.get(t.assigneeId) ?? DEFAULT_TIMEZONE;
    const hour = extractHourInTimezone(t.completedAt, tz);
    const bucket = agg.get(hour) ?? { count: 0, people: new Set<string>() };
    bucket.count += 1;
    bucket.people.add(t.assigneeId);
    agg.set(hour, bucket);
  }

  const byHour = byHourEmpty().map((slot) => {
    const bucket = agg.get(slot.hour);
    return bucket
      ? { hour: slot.hour, completedCount: bucket.count, peopleCompleted: bucket.people.size }
      : slot;
  });

  let peakHour: number | null = null;
  let peakCount = 0;
  for (const b of byHour) {
    if (b.completedCount > peakCount) {
      peakCount = b.completedCount;
      peakHour = b.hour;
    }
  }

  return { byHour, totalCompleted: tasks.length, peakHour, windowDays: days };
}
