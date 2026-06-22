import type { Request, Response } from "express";

import { idParamSchema } from "../schemas/common.js";
import * as jobService from "../services/job.service.js";

export async function getJob(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const job = await jobService.getJobStatus(req.user, id);
  res.status(200).json(job);
}
