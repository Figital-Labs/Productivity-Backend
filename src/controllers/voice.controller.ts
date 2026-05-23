import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import { submitVoiceInputSchema } from "../schemas/voice-intent.schema.js";
import * as voiceIntentService from "../services/voice-intent.service.js";

export async function process(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: audio");
  }

  // req.body is undefined when no form fields accompany the upload; default to
  // {} so the schema sees an empty object instead of erroring on "expected object".
  const input = submitVoiceInputSchema.parse((req.body as unknown) ?? {});

  const result = await voiceIntentService.processVoice(
    req.user,
    {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    },
    input,
  );

  res.status(201).json(result);
}
