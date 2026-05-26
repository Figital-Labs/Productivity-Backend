import type { Request, Response } from "express";

import type { InlineMedia } from "../lib/vertex.js";
import { idParamSchema } from "../schemas/common.js";
import {
  createMeetingInputSchema,
  processMeetingInputSchema,
  updateMeetingInputSchema,
} from "../schemas/meeting.schema.js";
import * as meetingService from "../services/meeting.service.js";

export async function listMeetings(req: Request, res: Response): Promise<void> {
  const meetings = await meetingService.listMeetings(req.user);
  res.status(200).json(meetings);
}

export async function getMeeting(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const meeting = await meetingService.getMeeting(req.user, id);
  res.status(200).json(meeting);
}

export async function createMeeting(req: Request, res: Response): Promise<void> {
  const input = createMeetingInputSchema.parse((req.body as unknown) ?? {});
  const meeting = await meetingService.createMeeting(req.user, input);
  res.status(201).json(meeting);
}

export async function updateMeeting(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = updateMeetingInputSchema.parse((req.body as unknown) ?? {});
  const meeting = await meetingService.updateMeeting(req.user, id, input);
  res.status(200).json(meeting);
}

export async function deleteMeeting(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  await meetingService.softDeleteMeeting(req.user, id);
  res.status(204).send();
}

export async function processMeeting(req: Request, res: Response): Promise<void> {
  // Long-running endpoint — Vertex audio + image fusion can take 30s–2min for
  // hour-long meetings. Default Node socket timeout is 120s; raise to 300s on
  // both the request and response so a slow Vertex call doesn't get cut off
  // mid-stream.
  req.setTimeout(300_000);
  res.setTimeout(300_000);

  const { id } = idParamSchema.parse(req.params);
  const input = processMeetingInputSchema.parse((req.body as unknown) ?? {});

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const audioFiles = files?.["audio"] ?? [];
  const imageFiles = files?.["images"] ?? [];

  const audioClips: InlineMedia[] = audioFiles.map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));
  const images: InlineMedia[] = imageFiles.map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimetype,
  }));

  const result = await meetingService.processMeeting(req.user, id, {
    audioClips,
    images,
    customPrompt: input.customPrompt,
    notes: input.notes,
  });
  res.status(200).json(result);
}
