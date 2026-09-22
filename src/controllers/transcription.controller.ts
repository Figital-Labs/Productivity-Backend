import type { Request, Response } from "express";

import { modelFor } from "../lib/ai-config.js";
import { ValidationError } from "../lib/errors.js";
import { withTrace } from "../lib/langfuse.js";
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
  const file = req.file;
  // Langfuse trace at the request boundary (the service itself has no user context).
  const result = await withTrace(
    {
      name: "transcribe",
      service: "transcription",
      userId: req.user.id,
      model: modelFor("transcribe"),
      input: { mimeType: file.mimetype, bytes: file.size },
    },
    () =>
      transcriptionService.transcribeAudio({
        buffer: file.buffer,
        mimeType: file.mimetype,
      }),
  );
  res.json(result);
}
