import type { Request, Response } from "express";

import { AppError, ValidationError } from "../lib/errors.js";
import {
  getDayClosureQuerySchema,
  submitDayClosureInputSchema,
} from "../schemas/day-closure.schema.js";
import * as dayClosureService from "../services/day-closure.service.js";

export async function submit(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: audio");
  }
  const input = submitDayClosureInputSchema.parse(req.body);
  const result = await dayClosureService.submitDayClosure(
    req.user,
    { buffer: req.file.buffer, mimeType: req.file.mimetype },
    input,
  );
  res.status(201).json(result);
}

export async function get(req: Request, res: Response): Promise<void> {
  const query = getDayClosureQuerySchema.parse(req.query);
  const closure = await dayClosureService.getDayClosure(req.user, query);
  if (!closure) {
    throw new AppError("DAY_CLOSURE_NOT_FOUND", 404, `No day closure submitted for ${query.date}.`);
  }
  res.json(closure);
}
