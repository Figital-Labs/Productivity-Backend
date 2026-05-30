import type { Request, Response } from "express";

import { ForbiddenError } from "../lib/errors.js";
import { resolveScope } from "../lib/resolve-scope.js";
import { idParamSchema } from "../schemas/common.js";
import {
  addGroupMemberSchema,
  createDepartmentSchema,
  createGroupSchema,
  createReminderSchema,
  dashboardActivityQuerySchema,
  dashboardConsistencyQuerySchema,
  dashboardGroupsQuerySchema,
  dashboardMeetingsQuerySchema,
  dashboardPeopleQuerySchema,
  dashboardTrendsQuerySchema,
  meetingConversionQuerySchema,
  meetingsAnalyticsQuerySchema,
  overdueQuerySchema,
  patchGroupMemberSchema,
  performersQuerySchema,
  personDayQuerySchema,
  planAccuracyQuerySchema,
  planVsClosureQuerySchema,
  taskFlowQuerySchema,
  updateDepartmentSchema,
  updateGroupSchema,
} from "../schemas/dashboard.schema.js";
import * as activityService from "../services/activity.service.js";
import * as analyticsService from "../services/dashboard-analytics.service.js";
import * as dashboardService from "../services/dashboard-rollup.service.js";
import * as treeService from "../services/dashboard-tree.service.js";
import * as morningBriefService from "../services/morning-brief.service.js";

export async function overview(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req.user);
  const userIds = await dashboardService.userIdsInScope(scope);
  res.json({
    kpis: await dashboardService.kpisForUsers(userIds),
    scope,
    asOf: new Date().toISOString(),
  });
}

export async function departments(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req.user);
  res.json({ departments: await dashboardService.departmentsForScope(scope) });
}

export async function groups(req: Request, res: Response): Promise<void> {
  const query = dashboardGroupsQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  res.json({ groups: await dashboardService.groupsForScope(scope, query) });
}

export async function people(req: Request, res: Response): Promise<void> {
  const query = dashboardPeopleQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  res.json({ people: await dashboardService.peopleForScope(scope, query) });
}

export async function consistency(req: Request, res: Response): Promise<void> {
  const query = dashboardConsistencyQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const userIds = await dashboardService.userIdsInScope(scope);
  res.json({ rows: await dashboardService.consistencyForUsers(userIds, query.days) });
}

export async function trends(req: Request, res: Response): Promise<void> {
  const query = dashboardTrendsQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const userIds = await dashboardService.userIdsInScope(scope);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await dashboardService.trendForUsers(userIds, query.metric, days));
}

export async function meetings(req: Request, res: Response): Promise<void> {
  const query = dashboardMeetingsQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  res.json({ meetings: await dashboardService.meetingsForScope(scope, query) });
}

export async function activity(req: Request, res: Response): Promise<void> {
  const query = dashboardActivityQuerySchema.parse(req.query);
  const events = await activityService.listActivity(req.user, query);
  res.json({ events });
}

export async function morningBrief(req: Request, res: Response): Promise<void> {
  res.json(await morningBriefService.getMorningBrief(req.user, false));
}

export async function refreshMorningBrief(req: Request, res: Response): Promise<void> {
  res.json(await morningBriefService.getMorningBrief(req.user, true));
}

export async function createDepartment(req: Request, res: Response): Promise<void> {
  const input = createDepartmentSchema.parse(req.body);
  res.status(201).json(await dashboardService.createDepartment(req.user, input));
}

export async function updateDepartment(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = updateDepartmentSchema.parse(req.body);
  res.json(await dashboardService.updateDepartment(req.user, id, input));
}

export async function createGroup(req: Request, res: Response): Promise<void> {
  const input = createGroupSchema.parse(req.body);
  res.status(201).json(await dashboardService.createGroup(req.user, input));
}

export async function updateGroup(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = updateGroupSchema.parse(req.body);
  res.json(await dashboardService.updateGroup(req.user, id, input));
}

export async function addGroupMember(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = addGroupMemberSchema.parse(req.body);
  res.json(await dashboardService.addGroupMember(req.user, id, input));
}

export async function removeGroupMember(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const userId = String(req.params["userId"] ?? "");
  res.json(await dashboardService.removeGroupMember(req.user, id, userId));
}

export async function createReminder(req: Request, res: Response): Promise<void> {
  const input = createReminderSchema.parse(req.body);
  const scope = await resolveScope(req.user);
  if (scope.type === "none") throw new ForbiddenError();
  res.json(await dashboardService.createReminder(req.user, scope, input));
}

// ─── Sprint 18 — Phase 2 handlers ──────────────────────────────────────────

export async function teamTree(req: Request, res: Response): Promise<void> {
  res.json({ nodes: await treeService.getTeamTree(req.user) });
}

export async function directory(req: Request, res: Response): Promise<void> {
  res.json(await treeService.getDirectory(req.user));
}

export async function personProfile(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.json(await treeService.getPersonProfile(req.user, id));
}

export async function personDay(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const query = personDayQuerySchema.parse(req.query);
  res.json(await treeService.getPersonDay(req.user, id, query.date));
}

export async function performers(req: Request, res: Response): Promise<void> {
  const query = performersQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  res.json(await analyticsService.getPerformers(scope, query.metric, query.days, query.limit));
}

export async function planVsClosure(req: Request, res: Response): Promise<void> {
  const query = planVsClosureQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await analyticsService.getPlanVsClosure(scope, days));
}

export async function summaryCards(req: Request, res: Response): Promise<void> {
  res.json(await analyticsService.getSummaryCards(await resolveScope(req.user)));
}

export async function groupAnalytics(req: Request, res: Response): Promise<void> {
  res.json({ rows: await analyticsService.getGroupAnalytics(await resolveScope(req.user)) });
}

export async function taskFlow(req: Request, res: Response): Promise<void> {
  const query = taskFlowQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await analyticsService.getTaskFlow(scope, days));
}

export async function submissionsToday(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req.user);
  res.json(await analyticsService.getSubmissionsToday(scope));
}

export async function priorityBreakdown(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(req.user);
  res.json(await analyticsService.getPriorityBreakdown(scope));
}

export async function overdueTasks(req: Request, res: Response): Promise<void> {
  const query = overdueQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  res.json(await analyticsService.getOverdueTasks(scope, query.limit));
}

export async function planAccuracy(req: Request, res: Response): Promise<void> {
  const query = planAccuracyQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await analyticsService.getPlanAccuracy(scope, days));
}

export async function meetingConversion(req: Request, res: Response): Promise<void> {
  const query = meetingConversionQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await analyticsService.getMeetingConversion(scope, days));
}

export async function meetingsAnalytics(req: Request, res: Response): Promise<void> {
  const query = meetingsAnalyticsQuerySchema.parse(req.query);
  const scope = await resolveScope(req.user);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await analyticsService.getMeetingsAnalytics(scope, days));
}

export async function patchGroupMember(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const userId = String(req.params["userId"] ?? "");
  const input = patchGroupMemberSchema.parse(req.body);
  res.json(await dashboardService.patchGroupMember(req.user, id, userId, input));
}
