import type { Request, Response } from "express";

import { AppError } from "../lib/errors.js";
import { listActivityQuerySchema } from "../schemas/activity.schema.js";
import * as activityService from "../services/activity.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  const parsed = listActivityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const isInvalidDateRange = parsed.error.issues.some(
      (issue) => issue.message === "`from` must be on or before `to`",
    );
    if (isInvalidDateRange) {
      throw new AppError("INVALID_DATE_RANGE", 400, "`from` must be on or before `to`.");
    }
    throw parsed.error;
  }

  const page = await activityService.listActivity(req.user, parsed.data);
  res.json(page);
}
