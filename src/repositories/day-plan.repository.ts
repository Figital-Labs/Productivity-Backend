import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { DayPlanSubmissionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type DayPlanSubmission = DayPlanSubmissionModel;

export interface CreateDayPlanData {
  userId: string;
  date: Date;
  taskSnapshot: InputJsonValue;
}

export function findByUserAndDate(userId: string, date: Date): Promise<DayPlanSubmission | null> {
  return prisma.dayPlanSubmission.findUnique({
    where: { userId_date: { userId, date } },
  });
}

export function create(data: CreateDayPlanData): Promise<DayPlanSubmission> {
  return prisma.dayPlanSubmission.create({ data });
}
