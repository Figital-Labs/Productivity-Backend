import { Router } from "express";

import * as teamController from "../controllers/team.controller.js";
import { requireManager } from "../middleware/require-manager.js";
import { requireOrgAdmin } from "../middleware/require-org-admin.js";
import { imageUpload, voiceUpload } from "../middleware/upload.js";

export const teamRouter = Router();

// All /team/* routes require manager or admin level (>= 300). Mounted under v1
// after jwtAuth so req.user is populated. Account-mutation routes below add an
// extra requireOrgAdmin gate — managers see/delegate, only admins own accounts.
teamRouter.use(requireManager);

// Rollup + drill-down (managers: operational read access to their subtree)
teamRouter.get("/reports", teamController.listReports);
teamRouter.get("/reports/tree", teamController.listManagedTree);
teamRouter.delete("/reports/:id", requireOrgAdmin, teamController.detachReport);
teamRouter.get("/reports/:id/tasks", teamController.getReportTasks);
teamRouter.get("/reports/:id/submissions", teamController.getReportSubmissions);

// Manual delegation
teamRouter.post("/tasks", teamController.createDelegatedTask);

// AI delegation surfaces
teamRouter.post("/voice/delegate", voiceUpload.single("audio"), teamController.delegateVoice);
teamRouter.post("/text/delegate", teamController.delegateText);
teamRouter.post("/image/delegate", imageUpload.single("image"), teamController.delegateImage);

// User CRUD + password mgmt — admin-only (account ownership).
// Note: /users/attach is declared before /users so the literal path matches
// first under any router implementation; documents intent even though
// Express 5 statics already win over dynamic `/users/:id/*` patterns.
teamRouter.post("/users/attach", requireOrgAdmin, teamController.attachExistingUser);
teamRouter.post("/users", requireOrgAdmin, teamController.createUser);
teamRouter.patch("/users/:id", requireOrgAdmin, teamController.updateUser);
teamRouter.post("/users/:id/reset-password", requireOrgAdmin, teamController.resetUserPassword);
