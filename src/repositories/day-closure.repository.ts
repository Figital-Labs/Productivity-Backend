import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { DayClosureSubmissionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type DayClosureSubmission = DayClosureSubmissionModel;

export interface CreateDayClosureData {
  userId: string;
  date: Date;
  commentary: string;
  aiFeedback: InputJsonValue;
  mediaIds: string[];
}

export function findByUserAndDate(
  userId: string,
  date: Date,
): Promise<DayClosureSubmission | null> {
  return prisma.dayClosureSubmission.findUnique({
    where: { userId_date: { userId, date } },
  });
}

export function create(data: CreateDayClosureData): Promise<DayClosureSubmission> {
  return prisma.dayClosureSubmission.create({ data });
}

export function listSubmittedInRange(
  userId: string,
  from?: Date,
  to?: Date,
): Promise<DayClosureSubmission[]> {
  return prisma.dayClosureSubmission.findMany({
    where: {
      userId,
      ...(from !== undefined || to !== undefined
        ? {
            submittedAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ submittedAt: "desc" }],
  });
}
