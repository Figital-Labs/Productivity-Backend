import type { Request, Response } from "express";

import { AppError, ValidationError } from "../lib/errors.js";
import {
  getDayClosureQuerySchema,
  submitDayClosureInputSchema,
} from "../schemas/day-closure.schema.js";
import * as dayClosureService from "../services/day-closure.service.js";

export async function submit(req: Request, res: Response): Promise<void> {
  const input = submitDayClosureInputSchema.parse(req.body);
  // Sprint 10: audio is now optional. The EOD multi-recording fix on the
  // frontend processes each recording via `/voice/process` and accumulates
  // transcripts into `commentary` — by the time we land here, the user has
  // already submitted a text commentary. Either modality must be present.
  if (!req.file && !input.commentary?.trim()) {
    throw new ValidationError("Either audio or commentary is required");
  }
  const audio = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;
  const result = await dayClosureService.submitDayClosure(req.user, audio, input);
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
