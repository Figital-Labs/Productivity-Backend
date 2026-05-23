import { Router } from "express";

import * as activityController from "../controllers/activity.controller.js";

export const activityRouter = Router();

activityRouter.get("/", activityController.list);
