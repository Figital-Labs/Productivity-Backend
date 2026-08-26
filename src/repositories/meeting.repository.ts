import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { MeetingModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type Meeting = MeetingModel;

export interface CreateMeetingData {
  userId: string;
  title: string;
  scheduledAt: Date;
  type: string;
  attendeeIds: string[];
  externalAttendees?: InputJsonValue | undefined;
  agenda?: string | undefined;
}

export interface UpdateMeetingData {
  title?: string | undefined;
  scheduledAt?: Date | undefined;
  type?: string | undefined;
  attendeeIds?: string[] | undefined;
  externalAttendees?: InputJsonValue | undefined;
  agenda?: string | undefined;
  notes?: string | undefined;
}

export interface RecordProcessedData {
  summary: string;
  customPrompt: string | undefined;
  actions: InputJsonValue;
  recommendations: InputJsonValue;
}

export function findById(id: string): Promise<Meeting | null> {
  return prisma.meeting.findUnique({ where: { id } });
}

export function listByUser(userId: string): Promise<Meeting[]> {
  return prisma.meeting.findMany({
    where: {
      deletedAt: null,
      OR: [{ userId }, { attendeeIds: { has: userId } }],
    },
    orderBy: [{ scheduledAt: "desc" }],
  });
}

/**
 * Activity-feed projection: list meetings processed in a date range. Filters
 * by `processedAt` (not `createdAt`) because the activity event represents
 * the moment AI returned a summary, not the moment the meeting was scheduled.
 */
export function listProcessedInRange(userId: string, from?: Date, to?: Date): Promise<Meeting[]> {
  return prisma.meeting.findMany({
    where: {
      userId,
      deletedAt: null,
      processedAt: {
        not: null,
        ...(from !== undefined ? { gte: from } : {}),
        ...(to !== undefined ? { lte: to } : {}),
      },
    },
    orderBy: [{ processedAt: "desc" }],
  });
}

export function create(data: CreateMeetingData): Promise<Meeting> {
  return prisma.meeting.create({ data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateMeetingData): Promise<Meeting> {
  return prisma.meeting.update({ where: { id }, data: omitUndefined(patch) });
}

export function softDelete(id: string): Promise<Meeting> {
  return prisma.meeting.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function updateRecommendationStatus(
  id: string,
  index: number,
  status: string,
): Promise<Meeting | null> {
  const meeting = await findById(id);
  if (meeting?.deletedAt !== null) return null;
  const recs = Array.isArray(meeting.recommendations)
    ? [...(meeting.recommendations as Record<string, unknown>[])]
    : [];
  if (index < 0 || index >= recs.length) return null;
  recs[index] = { ...recs[index], status };
  return prisma.meeting.update({
    where: { id },
    data: { recommendations: recs as InputJsonValue },
  });
}

export function recordProcessed(id: string, data: RecordProcessedData): Promise<Meeting> {
  return prisma.meeting.update({
    where: { id },
    data: {
      summary: data.summary,
      customPrompt: data.customPrompt ?? null,
      actions: data.actions,
      recommendations: data.recommendations,
      processedAt: new Date(),
    },
  });
}

/**
 * Persist the S3 object keys for the audio/images sent for processing. Written BEFORE the AI
 * call (store-then-process) so the audit trail survives even when the meeting isn't marked
 * processed (no-content / Vertex failure). Powers the Media tab.
 */
export function updateMediaKeys(id: string, mediaKeys: string[]): Promise<Meeting> {
  return prisma.meeting.update({ where: { id }, data: { mediaKeys } });
}
