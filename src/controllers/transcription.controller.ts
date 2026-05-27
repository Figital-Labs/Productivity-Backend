import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import * as transcriptionService from "../services/transcription.service.js";

/**
 * Sprint 17 — `POST /transcribe`. Reusable audio→text. Auth via `jwtAuth`,
 * no role gate. Single-file multipart on field `audio` (10 MB cap, same
 * MIME whitelist as `/voice/process`). No DB row written, no task mutated.
 */
export async function transcribe(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Audio file is required on field `audio`.");
  }
  const result = await transcriptionService.transcribeAudio({
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
  });
  res.json(result);
}
