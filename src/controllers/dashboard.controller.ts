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
  updateDepartmentSchema,
  updateGroupSchema,
} from "../schemas/dashboard.schema.js";
import * as activityService from "../services/activity.service.js";
import * as dashboardService from "../services/dashboard-rollup.service.js";
import * as morningBriefService from "../services/morning-brief.service.js";

async function requireResolvedScope(req: Request) {
  const scope = await resolveScope(req.user);
  if (scope.type === "none") {
    throw new ForbiddenError();
  }
  return scope;
}

export async function overview(req: Request, res: Response): Promise<void> {
  const scope = await requireResolvedScope(req);
  const userIds = await dashboardService.userIdsInScope(scope);
  res.json({
    kpis: await dashboardService.kpisForUsers(userIds),
    scope,
    asOf: new Date().toISOString(),
  });
}

export async function departments(req: Request, res: Response): Promise<void> {
  res.json({
    departments: await dashboardService.departmentsForScope(await requireResolvedScope(req)),
  });
}

export async function groups(req: Request, res: Response): Promise<void> {
  const query = dashboardGroupsQuerySchema.parse(req.query);
  res.json({
    groups: await dashboardService.groupsForScope(await requireResolvedScope(req), query),
  });
}

export async function people(req: Request, res: Response): Promise<void> {
  const query = dashboardPeopleQuerySchema.parse(req.query);
  res.json({
    people: await dashboardService.peopleForScope(await requireResolvedScope(req), query),
  });
}

export async function consistency(req: Request, res: Response): Promise<void> {
  const query = dashboardConsistencyQuerySchema.parse(req.query);
  const scope = await requireResolvedScope(req);
  const userIds = await dashboardService.userIdsInScope(scope);
  res.json({ rows: await dashboardService.consistencyForUsers(userIds, query.days) });
}

export async function trends(req: Request, res: Response): Promise<void> {
  const query = dashboardTrendsQuerySchema.parse(req.query);
  const scope = await requireResolvedScope(req);
  const userIds = await dashboardService.userIdsInScope(scope);
  const days = query.range === "30d" ? 30 : 7;
  res.json(await dashboardService.trendForUsers(userIds, query.metric, days));
}

export async function meetings(req: Request, res: Response): Promise<void> {
  const query = dashboardMeetingsQuerySchema.parse(req.query);
  res.json({
    meetings: await dashboardService.meetingsForScope(await requireResolvedScope(req), query),
  });
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
  res.json(await dashboardService.createReminder(req.user, await requireResolvedScope(req), input));
}
