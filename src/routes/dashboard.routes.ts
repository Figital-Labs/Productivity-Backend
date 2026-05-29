import { Router } from "express";

import * as dashboardController from "../controllers/dashboard.controller.js";
import { requireManager } from "../middleware/require-manager.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireManager);

dashboardRouter.get("/overview", dashboardController.overview);
dashboardRouter.get("/departments", dashboardController.departments);
dashboardRouter.post("/departments", dashboardController.createDepartment);
dashboardRouter.patch("/departments/:id", dashboardController.updateDepartment);
dashboardRouter.get("/groups", dashboardController.groups);
dashboardRouter.post("/groups", dashboardController.createGroup);
dashboardRouter.patch("/groups/:id", dashboardController.updateGroup);
dashboardRouter.post("/groups/:id/members", dashboardController.addGroupMember);
dashboardRouter.patch("/groups/:id/members/:userId", dashboardController.patchGroupMember);
dashboardRouter.delete("/groups/:id/members/:userId", dashboardController.removeGroupMember);
dashboardRouter.get("/people", dashboardController.people);
dashboardRouter.get("/consistency", dashboardController.consistency);
dashboardRouter.get("/trends", dashboardController.trends);
dashboardRouter.get("/meetings", dashboardController.meetings);
dashboardRouter.get("/activity", dashboardController.activity);
dashboardRouter.get("/morning-brief", dashboardController.morningBrief);
dashboardRouter.post("/morning-brief/refresh", dashboardController.refreshMorningBrief);
dashboardRouter.post("/reminders", dashboardController.createReminder);

// Sprint 18 — Phase 2 endpoints.
dashboardRouter.get("/summary-cards", dashboardController.summaryCards);
dashboardRouter.get("/performers", dashboardController.performers);
dashboardRouter.get("/analytics/plan-vs-closure", dashboardController.planVsClosure);
dashboardRouter.get("/analytics/groups", dashboardController.groupAnalytics);
dashboardRouter.get("/analytics/task-flow", dashboardController.taskFlow);
dashboardRouter.get("/analytics/submissions-today", dashboardController.submissionsToday);
dashboardRouter.get("/analytics/priority-breakdown", dashboardController.priorityBreakdown);
dashboardRouter.get("/analytics/overdue", dashboardController.overdueTasks);
dashboardRouter.get("/analytics/plan-accuracy", dashboardController.planAccuracy);
dashboardRouter.get("/analytics/meeting-conversion", dashboardController.meetingConversion);
dashboardRouter.get("/team/tree", dashboardController.teamTree);
dashboardRouter.get("/directory", dashboardController.directory);
// :id-tail routes must come AFTER any literal /people segments above.
dashboardRouter.get("/people/:id", dashboardController.personProfile);
dashboardRouter.get("/people/:id/day", dashboardController.personDay);
