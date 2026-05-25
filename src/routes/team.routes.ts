import { Router } from "express";

import * as teamController from "../controllers/team.controller.js";
import { requireManager } from "../middleware/require-manager.js";
import { imageUpload, voiceUpload } from "../middleware/upload.js";

export const teamRouter = Router();

// All /team/* routes require manager or admin role. Mounted under v1 after
// jwtAuth so req.user is populated before this check.
teamRouter.use(requireManager);

// Rollup + drill-down
teamRouter.get("/reports", teamController.listReports);
teamRouter.get("/reports/:id/tasks", teamController.getReportTasks);
teamRouter.get("/reports/:id/submissions", teamController.getReportSubmissions);

// Manual delegation
teamRouter.post("/tasks", teamController.createDelegatedTask);

// AI delegation surfaces
teamRouter.post("/voice/delegate", voiceUpload.single("audio"), teamController.delegateVoice);
teamRouter.post("/text/delegate", teamController.delegateText);
teamRouter.post("/image/delegate", imageUpload.single("image"), teamController.delegateImage);

// User CRUD + password mgmt
teamRouter.post("/users", teamController.createUser);
teamRouter.post("/users/:id/reset-password", teamController.resetUserPassword);
