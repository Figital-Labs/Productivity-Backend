import type { Request, Response } from "express";

import { ValidationError } from "../lib/errors.js";
import { idParamSchema } from "../schemas/common.js";
import { submitTeamImageDelegateInputSchema } from "../schemas/team-image-delegate.schema.js";
import { submitTeamTextDelegateInputSchema } from "../schemas/team-text-delegate.schema.js";
import { submitTeamVoiceDelegateInputSchema } from "../schemas/team-voice-delegate.schema.js";
import {
  attachExistingUserInputSchema,
  createDelegatedTaskInputSchema,
  createTeamUserInputSchema,
  getReportSubmissionsQuerySchema,
  getReportTasksQuerySchema,
  resetTeamUserPasswordInputSchema,
} from "../schemas/team.schema.js";
import * as teamImageDelegateService from "../services/team-image-delegate.service.js";
import * as teamTextDelegateService from "../services/team-text-delegate.service.js";
import * as teamVoiceDelegateService from "../services/team-voice-delegate.service.js";
import * as teamService from "../services/team.service.js";
import { parseDateString } from "../utils/date.js";

export async function listReports(req: Request, res: Response): Promise<void> {
  const reports = await teamService.listReports(req.user);
  res.status(200).json(reports);
}

export async function getReportTasks(req: Request, res: Response): Promise<void> {
  const { id: reportId } = idParamSchema.parse(req.params);
  const query = getReportTasksQuerySchema.parse(req.query);
  const tasks = await teamService.getReportTasks(req.user, reportId, parseDateString(query.date));
  res.status(200).json(tasks);
}

export async function getReportSubmissions(req: Request, res: Response): Promise<void> {
  const { id: reportId } = idParamSchema.parse(req.params);
  const query = getReportSubmissionsQuerySchema.parse(req.query);
  const submissions = await teamService.getReportSubmissions(
    req.user,
    reportId,
    parseDateString(query.date),
  );
  res.status(200).json(submissions);
}

export async function createDelegatedTask(req: Request, res: Response): Promise<void> {
  const input = createDelegatedTaskInputSchema.parse((req.body as unknown) ?? {});
  const task = await teamService.createDelegatedTask(req.user, input);
  res.status(201).json(task);
}

export async function delegateVoice(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: audio");
  }
  const input = submitTeamVoiceDelegateInputSchema.parse((req.body as unknown) ?? {});
  const result = await teamVoiceDelegateService.delegateVoice(
    req.user,
    { buffer: req.file.buffer, mimeType: req.file.mimetype },
    input,
  );
  res.status(201).json(result);
}

export async function delegateText(req: Request, res: Response): Promise<void> {
  const input = submitTeamTextDelegateInputSchema.parse((req.body as unknown) ?? {});
  const result = await teamTextDelegateService.delegateText(req.user, input);
  res.status(201).json(result);
}

export async function delegateImage(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new ValidationError("Missing required multipart field: image");
  }
  const input = submitTeamImageDelegateInputSchema.parse((req.body as unknown) ?? {});
  const result = await teamImageDelegateService.delegateImage(
    req.user,
    { buffer: req.file.buffer, mimeType: req.file.mimetype },
    input,
  );
  res.status(201).json(result);
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const input = createTeamUserInputSchema.parse((req.body as unknown) ?? {});
  const user = await teamService.createUser(req.user, input);
  res.status(201).json(user);
}

export async function attachExistingUser(req: Request, res: Response): Promise<void> {
  const input = attachExistingUserInputSchema.parse((req.body as unknown) ?? {});
  const user = await teamService.attachExistingUser(req.user, input);
  res.status(201).json(user);
}

export async function resetUserPassword(req: Request, res: Response): Promise<void> {
  const { id: targetUserId } = idParamSchema.parse(req.params);
  const input = resetTeamUserPasswordInputSchema.parse((req.body as unknown) ?? {});
  await teamService.resetUserPassword(req.user, targetUserId, input);
  res.status(204).send();
}
