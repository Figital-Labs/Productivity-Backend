import { Router } from "express";

import * as jobController from "../controllers/job.controller.js";

export const jobsRouter = Router();

// ADR-0025: poll target for async media processing. `jwtAuth` is applied at the v1 level.
jobsRouter.get("/:id", jobController.getJob);
