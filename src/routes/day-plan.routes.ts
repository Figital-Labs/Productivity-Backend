import { Router } from "express";

import * as dayPlanController from "../controllers/day-plan.controller.js";

export const dayPlanRouter = Router();

dayPlanRouter.post("/submit", dayPlanController.submit);
dayPlanRouter.post("/:id/mark-reviewed", dayPlanController.markReviewed);
dayPlanRouter.get("/", dayPlanController.get);
