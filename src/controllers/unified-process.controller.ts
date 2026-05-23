import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import { submitUnifiedInputSchema } from "../schemas/unified-intent.schema.js";
import * as unifiedProcessService from "../services/unified-process.service.js";

export async function process(req: Request, res: Response): Promise<void> {
  const files = req.files as
    | { audio?: Express.Multer.File[]; image?: Express.Multer.File[] }
    | undefined;

  const audioFile = files?.audio?.[0];
  const imageFile = files?.image?.[0];
  // req.body is undefined when no multipart payload reaches the parser
  // (curl with no -F flags). Default to {} so the "at least one modality"
  // error message wins over zod's generic "expected object" message.
  const { text, targetDate } = submitUnifiedInputSchema.parse((req.body as unknown) ?? {});

  if (audioFile === undefined && imageFile === undefined && text === undefined) {
    throw new ValidationError("At least one of audio, image, or text must be provided.");
  }

  const input = {
    ...(audioFile !== undefined && {
      audio: { buffer: audioFile.buffer, mimeType: audioFile.mimetype },
    }),
    ...(imageFile !== undefined && {
      image: { buffer: imageFile.buffer, mimeType: imageFile.mimetype },
    }),
    ...(text !== undefined && { text }),
    ...(targetDate !== undefined && { targetDate }),
  };

  const result = await unifiedProcessService.processUnified(req.user, input);

  res.status(201).json(result);
}
