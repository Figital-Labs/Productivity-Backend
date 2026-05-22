import type { Request, Response } from "express";

import { submitTextInputSchema } from "../schemas/text-process.schema.js";
import * as textProcessService from "../services/text-process.service.js";

export async function process(req: Request, res: Response): Promise<void> {
  const input = submitTextInputSchema.parse(req.body);
  const result = await textProcessService.processText(req.user, input);
  res.status(201).json(result);
}
