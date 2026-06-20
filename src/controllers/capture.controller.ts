import type { Request, Response } from "express";

import {
  capturePresignSchema,
  captureProcessSchema,
  captureSurfaceEnum,
} from "../schemas/capture.schema.js";
import { idParamSchema } from "../schemas/common.js";
import * as captureService from "../services/capture.service.js";

export async function presign(req: Request, res: Response): Promise<void> {
  const input = capturePresignSchema.parse((req.body as unknown) ?? {});
  const presigned = await captureService.presignCapture(req.user, input.surface, input.contentType);
  res.status(200).json(presigned);
}

export async function process(req: Request, res: Response): Promise<void> {
  // ADR-0025: enqueue + return 202 immediately; the worker runs Vertex out-of-band and the FE polls
  // GET /jobs/:id. Body is JSON `{ surface, key }` (direct-to-S3 happy path) OR multipart
  // `{ surface, file }` (byte fallback). `req.file` is undefined on the JSON path.
  const input = captureProcessSchema.parse((req.body as unknown) ?? {});
  const file = req.file;
  const result = await captureService.enqueueCapture(req.user, input.surface, {
    ...(input.key !== undefined ? { key: input.key } : {}),
    ...(file ? { bytes: { buffer: file.buffer, mimeType: file.mimetype } } : {}),
    ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
  });
  res.status(202).json(result);
}

export async function getResult(req: Request, res: Response): Promise<void> {
  const surface = captureSurfaceEnum.parse((req.params as { surface?: unknown }).surface);
  const { id } = idParamSchema.parse(req.params);
  const result = await captureService.getCaptureResult(req.user, surface, id);
  res.status(200).json(result);
}
