import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import { submitImageInputSchema } from "../schemas/image-extraction.schema.js";
import * as imageExtractionService from "../services/image-extraction.service.js";

export async function process(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: image");
  }

  const input = submitImageInputSchema.parse((req.body as unknown) ?? {});

  const result = await imageExtractionService.processImage(
    req.user,
    {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    },
    input,
  );

  res.status(201).json(result);
}
