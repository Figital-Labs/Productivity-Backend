import { z } from "zod";

import { dateStringSchema } from "./common.js";

export const dashboardIncludeSchema = z.enum(["personal"]);

export const dashboardGroupsQuerySchema = z.object({
  departmentId: z.string().optional(),
  include: dashboardIncludeSchema.optional(),
});
export type DashboardGroupsQuery = z.infer<typeof dashboardGroupsQuerySchema>;

export const dashboardPeopleQuerySchema = z.object({
  scope: z.enum(["org", "dept", "group"]).optional(),
  id: z.string().optional(),
});
export type DashboardPeopleQuery = z.infer<typeof dashboardPeopleQuerySchema>;

export const dashboardConsistencyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});
export type DashboardConsistencyQuery = z.infer<typeof dashboardConsistencyQuerySchema>;

export const dashboardTrendsQuerySchema = z.object({
  metric: z.enum(["tasks", "plans", "closures"]),
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type DashboardTrendsQuery = z.infer<typeof dashboardTrendsQuerySchema>;

export const dashboardMeetingsQuerySchema = z.object({
  date: dateStringSchema.optional(),
});
export type DashboardMeetingsQuery = z.infer<typeof dashboardMeetingsQuerySchema>;

export const dashboardActivityQuerySchema = z.object({
  scope: z.enum(["personal", "team", "org"]).default("team"),
  cursor: z.string().optional(),
});
export type DashboardActivityQuery = z.infer<typeof dashboardActivityQuerySchema>;

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  headId: z.string().optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  headId: z.string().nullable().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(40).default("ward"),
  departmentId: z.string().nullable().optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.string().trim().min(1).max(40).optional(),
  departmentId: z.string().nullable().optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const addGroupMemberSchema = z.object({
  userId: z.string(),
  isLead: z.boolean().optional(),
  canManage: z.boolean().optional(),
  reason: z.string().trim().max(200).optional(),
});
export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>;

export const createReminderSchema = z.object({
  targetUserId: z.string(),
  kind: z.enum(["plan", "closure"]),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

// ───────────────────────────────────────────────────────────────────────────
// Sprint 18 — Phase 2 endpoints
// ───────────────────────────────────────────────────────────────────────────

/** `GET /dashboard/performers` — top + bottom over scoped users. */
export const performersQuerySchema = z.object({
  metric: z.enum(["tasks", "consistency"]).default("tasks"),
  days: z.coerce.number().int().min(1).max(30).default(7),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});
export type PerformersQuery = z.infer<typeof performersQuerySchema>;

/** `GET /dashboard/analytics/plan-vs-closure` — per-day series. */
export const planVsClosureQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type PlanVsClosureQuery = z.infer<typeof planVsClosureQuerySchema>;

/** `GET /dashboard/people/:id/day?date=` — scope-aware person day. */
export const personDayQuerySchema = z.object({
  date: dateStringSchema.optional(),
});
export type PersonDayQuery = z.infer<typeof personDayQuerySchema>;

/** `GET /dashboard/analytics/task-flow` — daily task inflow vs outflow. */
export const taskFlowQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type TaskFlowQuery = z.infer<typeof taskFlowQuerySchema>;

/** `GET /dashboard/analytics/overdue` — overdue incomplete tasks in scope. */
export const overdueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export type OverdueQuery = z.infer<typeof overdueQuerySchema>;

// `GET /dashboard/analytics/submissions-today` has no query params — always today.

/** `GET /dashboard/analytics/plan-accuracy` — snapshot completion rate per day. */
export const planAccuracyQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type PlanAccuracyQuery = z.infer<typeof planAccuracyQuerySchema>;

/** `GET /dashboard/analytics/meeting-conversion` — meeting-sourced task completion rate. */
export const meetingConversionQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type MeetingConversionQuery = z.infer<typeof meetingConversionQuerySchema>;

/** `GET /dashboard/analytics/meetings` — daily meeting count + action items. */
export const meetingsAnalyticsQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type MeetingsAnalyticsQuery = z.infer<typeof meetingsAnalyticsQuerySchema>;

/** `GET /dashboard/analytics/schedule-heatmap?date=` — per-person hourly load. */
export const scheduleHeatmapQuerySchema = z.object({
  date: dateStringSchema.optional(),
  // When present, return that department's per-person grid (drill-down). Absent
  // = team-wide availability curve only. "__none__" = the no-department bucket.
  departmentId: z.string().optional(),
});
export type ScheduleHeatmapQuery = z.infer<typeof scheduleHeatmapQuerySchema>;

/** `GET /dashboard/analytics/schedule-adherence` — scheduled-vs-done, on-time. */
export const scheduleAdherenceQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type ScheduleAdherenceQuery = z.infer<typeof scheduleAdherenceQuerySchema>;

/** `GET /dashboard/analytics/productive-hours` — team task completions by hour-of-day. */
export const productiveHoursQuerySchema = z.object({
  range: z.enum(["7d", "30d"]).default("7d"),
});
export type ProductiveHoursQuery = z.infer<typeof productiveHoursQuerySchema>;

/** `PATCH /dashboard/groups/:id/members/:userId` — flip lead / canManage. */
export const patchGroupMemberSchema = z
  .object({
    isLead: z.boolean().optional(),
    canManage: z.boolean().optional(),
  })
  .refine((v) => v.isLead !== undefined || v.canManage !== undefined, {
    message: "At least one of isLead or canManage is required.",
  });
export type PatchGroupMemberInput = z.infer<typeof patchGroupMemberSchema>;

export const kpisSchema = z.object({
  activeStaffToday: z.number().int().nonnegative(),
  plansSubmittedToday: z.number().int().nonnegative(),
  plansSubmittedPct: z.number(),
  closuresSubmittedToday: z.number().int().nonnegative(),
  closuresSubmittedPct: z.number(),
  totalTasks: z.number().int().nonnegative(),
  tasksDone: z.number().int().nonnegative(),
  tasksDonePct: z.number(),
});
export type Kpis = z.infer<typeof kpisSchema>;

export const trendSeriesSchema = z.object({
  series: z.array(z.object({ date: dateStringSchema, value: z.number() })),
  deltaPct: z.number(),
});
export type TrendSeries = z.infer<typeof trendSeriesSchema>;

export const consistencyRowSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    designation: z.string().nullish(),
  }),
  planMissedDays: z.number().int().nonnegative(),
  closureMissedDays: z.number().int().nonnegative(),
  lastSubmittedAt: z.string().nullable(),
});
export type ConsistencyRow = z.infer<typeof consistencyRowSchema>;

export const morningBriefResponseSchema = z.object({
  // Sprint 18 (L5): manager-facing executive brief, English only. Renamed from
  // `summaryHinglish`. Personal-task AI flows still output Hinglish — untouched.
  summary: z.string().min(20).max(800),
  highlights: z.array(z.string().max(120)).min(0).max(4),
  concerns: z.array(z.string().max(120)).min(0).max(4),
  topPerformers: z.array(z.object({ userId: z.string(), name: z.string() })).max(3),
  needsAttention: z
    .array(z.object({ userId: z.string(), name: z.string(), reason: z.string().max(120) }))
    .max(3),
});
export type MorningBriefPayload = z.infer<typeof morningBriefResponseSchema>;
