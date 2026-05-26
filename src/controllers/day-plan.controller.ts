import type { Request, Response } from "express";

import { AppError } from "../lib/errors.js";
import { idParamSchema } from "../schemas/common.js";
import { getDayPlanQuerySchema, submitDayPlanInputSchema } from "../schemas/day-plan.schema.js";
import * as dayPlanService from "../services/day-plan.service.js";

export async function submit(req: Request, res: Response): Promise<void> {
  const input = submitDayPlanInputSchema.parse(req.body);
  const plan = await dayPlanService.submitDayPlan(req.user, input);
  res.status(201).json(plan);
}

export async function get(req: Request, res: Response): Promise<void> {
  const query = getDayPlanQuerySchema.parse(req.query);
  if (query.unreviewed === "true") {
    res.json(await dayPlanService.listUnreviewedPlans(req.user));
    return;
  }
  const plan = await dayPlanService.getDayPlan(req.user, query);
  if (!plan) {
    throw new AppError("DAY_PLAN_NOT_FOUND", 404, `No day plan submitted for ${query.date ?? ""}.`);
  }
  res.json(plan);
}

export async function markReviewed(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.json(await dayPlanService.markPlanReviewed(req.user, id));
}
