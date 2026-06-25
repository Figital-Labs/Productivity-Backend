import { Router } from "express";

import * as adminController from "../controllers/admin.controller.js";
import { requireSuperAdmin } from "../middleware/require-super-admin.js";

// Cross-org super-admin (root) surface. Mounted under v1 after jwtAuth; every
// route requires the root flag.
export const adminRouter = Router();

adminRouter.use(requireSuperAdmin);

// Org management
adminRouter.get("/orgs", adminController.listOrgs);
adminRouter.post("/orgs", adminController.createOrg);
adminRouter.get("/orgs/:id", adminController.orgDetail);
adminRouter.patch("/orgs/:id", adminController.renameOrg);
adminRouter.post("/orgs/:id/admins", adminController.bootstrapAdmin);

// AI usage audit
adminRouter.get("/orgs/:id/ai-usage", adminController.orgAiUsage);
adminRouter.get("/orgs/:id/interactions", adminController.orgInteractions);
adminRouter.get("/interactions/:type/:id", adminController.interactionDetail);
