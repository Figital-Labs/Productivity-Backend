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
dashboardRouter.delete("/groups/:id/members/:userId", dashboardController.removeGroupMember);
dashboardRouter.get("/people", dashboardController.people);
dashboardRouter.get("/consistency", dashboardController.consistency);
dashboardRouter.get("/trends", dashboardController.trends);
dashboardRouter.get("/meetings", dashboardController.meetings);
dashboardRouter.get("/activity", dashboardController.activity);
dashboardRouter.get("/morning-brief", dashboardController.morningBrief);
dashboardRouter.post("/morning-brief/refresh", dashboardController.refreshMorningBrief);
dashboardRouter.post("/reminders", dashboardController.createReminder);
