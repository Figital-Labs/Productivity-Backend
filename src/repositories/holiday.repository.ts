import type { HolidayModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type Holiday = HolidayModel;

export interface UpsertHolidayData {
  userId: string;
  date: Date;
  reason?: string;
}

export function findByUserAndDate(userId: string, date: Date): Promise<Holiday | null> {
  return prisma.holiday.findUnique({
    where: { userId_date: { userId, date } },
  });
}

export function listInRange(userId: string, from: Date, to: Date): Promise<Holiday[]> {
  return prisma.holiday.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
}

export function upsert(data: UpsertHolidayData): Promise<Holiday> {
  const reason = data.reason ?? null;
  return prisma.holiday.upsert({
    where: { userId_date: { userId: data.userId, date: data.date } },
    update: { reason },
    create: { userId: data.userId, date: data.date, reason },
  });
}

export function remove(userId: string, date: Date): Promise<Holiday> {
  return prisma.holiday.delete({
    where: { userId_date: { userId, date } },
  });
}
