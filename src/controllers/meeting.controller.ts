import type { Request, Response } from "express";

import type { InlineMedia } from "../lib/vertex.js";
import { idParamSchema } from "../schemas/common.js";
import {
  createMeetingInputSchema,
  deleteMediaInputSchema,
  patchRecommendationStatusSchema,
  presignMediaInputSchema,
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

export async function getMeetingMedia(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const media = await meetingService.getMeetingMedia(req.user, id);
  res.status(200).json({ media });
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

export async function patchRecommendationStatus(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const rawIndex = parseInt((req.params as { index?: string }).index ?? "", 10);
  if (Number.isNaN(rawIndex) || rawIndex < 0) {
    res
      .status(400)
      .json({ error: { code: "INVALID_INDEX", message: "Invalid recommendation index." } });
    return;
  }
  const input = patchRecommendationStatusSchema.parse((req.body as unknown) ?? {});
  const meeting = await meetingService.patchRecommendationStatus(
    req.user,
    id,
    rawIndex,
    input.status,
  );
  res.status(200).json(meeting);
}

export async function processMeeting(req: Request, res: Response): Promise<void> {
  // ADR-0025: enqueue + return 202 immediately. The (slow) Vertex fusion runs in the
  // worker out-of-band; the frontend polls GET /jobs/:id. No socket-timeout hack needed.
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

  // Clips the browser already uploaded straight to S3 (presigned). Bytes above are the
  // fallback for clips whose direct upload didn't happen (CORS off / failed).
  const audioKeys = parseMediaKeys((req.body as { mediaKeys?: unknown }).mediaKeys);

  const result = await meetingService.enqueueProcessing(req.user, id, {
    audioKeys,
    audioClips,
    images,
    customPrompt: input.customPrompt,
    notes: input.notes,
  });
  res.status(202).json(result);
}

/** Parse the multipart `mediaKeys` field (a JSON array of S3 keys) safely. */
function parseMediaKeys(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const keys = parsed.filter((k): k is string => typeof k === "string");
      if (keys.length === parsed.length) return keys;
    }
  } catch {
    // malformed → treat as none (fall back to byte clips)
  }
  return [];
}

export async function presignMeetingMedia(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = presignMediaInputSchema.parse((req.body as unknown) ?? {});
  const presigned = await meetingService.presignMeetingMedia(req.user, id, input.contentType);
  res.status(200).json(presigned);
}

export async function deleteMeetingMedia(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = deleteMediaInputSchema.parse((req.body as unknown) ?? {});
  await meetingService.deleteMeetingMedia(req.user, id, input.key);
  res.status(204).send();
}
