import { Router } from "express";

import * as orgController from "../controllers/organization.controller.js";
import { requireSuperAdmin } from "../middleware/require-super-admin.js";

export const organizationRouter = Router();

// List: anyone authenticated can call this. Root sees every org (drives the
// org-switcher in the dashboard); non-root sees a single row for their own org
// (drives the "current org" badge). The service handles the scoping.
organizationRouter.get("/", orgController.list);

// Create + bootstrap an org admin: root-only.
organizationRouter.post("/", requireSuperAdmin, orgController.create);
organizationRouter.post("/:id/admins", requireSuperAdmin, orgController.bootstrapAdmin);
