import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import * as imageExtractionService from "../services/image-extraction.service.js";

export async function process(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: image");
  }

  const result = await imageExtractionService.processImage(req.user, {
    buffer: req.file.buffer,
    mimeType: req.file.mimetype,
  });

  res.status(201).json(result);
}
