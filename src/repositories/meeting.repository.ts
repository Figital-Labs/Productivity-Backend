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
  agenda?: string | undefined;
}

export interface UpdateMeetingData {
  title?: string | undefined;
  scheduledAt?: Date | undefined;
  type?: string | undefined;
  attendeeIds?: string[] | undefined;
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
    where: { userId, deletedAt: null },
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
