import type { Request, Response } from "express";

import { AppError } from "../lib/errors.js";
import { idParamSchema } from "../schemas/common.js";
import {
  getDayClosureQuerySchema,
  reviewDayClosureInputSchema,
  submitDayClosureInputSchema,
} from "../schemas/day-closure.schema.js";
import * as dayClosureService from "../services/day-closure.service.js";

/**
 * Sprint 17 Phase 2 — `POST /day-closure/review`.
 * Generates the AI feedback once, persists a draft, and returns it. Re-calling
 * on an existing draft returns the same payload without hitting Vertex.
 */
export async function review(req: Request, res: Response): Promise<void> {
  const input = reviewDayClosureInputSchema.parse(req.body);
  const result = await dayClosureService.reviewDayClosure(req.user, input);
  res.status(201).json(result);
}

/**
 * Sprint 17 Phase 3 — `POST /day-closure/submit`.
 * Finalizes a draft created by `/review`. No audio, no voice processing —
 * closure voice is excuse commentary only, transcribed via `POST /transcribe`
 * before being sent here as part of `commentary`.
 */
export async function submit(req: Request, res: Response): Promise<void> {
  const input = submitDayClosureInputSchema.parse(req.body);
  const result = await dayClosureService.submitDayClosure(req.user, input);
  res.status(200).json(result);
}

export async function get(req: Request, res: Response): Promise<void> {
  const query = getDayClosureQuerySchema.parse(req.query);
  if (query.unreviewed === "true") {
    res.json(await dayClosureService.listUnreviewedClosures(req.user));
    return;
  }
  const closure = await dayClosureService.getDayClosure(req.user, query);
  if (!closure) {
    throw new AppError(
      "DAY_CLOSURE_NOT_FOUND",
      404,
      `No day closure submitted for ${query.date ?? ""}.`,
    );
  }
  res.json(closure);
}

export async function markReviewed(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.json(await dayClosureService.markClosureReviewed(req.user, id));
}
