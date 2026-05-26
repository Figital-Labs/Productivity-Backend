import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { MorningBriefCacheModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type MorningBriefCache = MorningBriefCacheModel;

export function findCache(managerId: string, date: Date): Promise<MorningBriefCache | null> {
  return prisma.morningBriefCache.findUnique({
    where: { managerId_date: { managerId, date } },
  });
}

export function lastGeneratedAt(
  managerId: string,
): Promise<Pick<MorningBriefCache, "generatedAt"> | null> {
  return prisma.morningBriefCache.findFirst({
    where: { managerId },
    select: { generatedAt: true },
    orderBy: { generatedAt: "desc" },
  });
}

export function upsertCache(
  managerId: string,
  date: Date,
  payload: InputJsonValue,
): Promise<MorningBriefCache> {
  return prisma.morningBriefCache.upsert({
    where: { managerId_date: { managerId, date } },
    create: { managerId, date, payload },
    update: { payload, generatedAt: new Date() },
  });
}
