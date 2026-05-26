import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { DayClosureSubmissionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type DayClosureSubmission = DayClosureSubmissionModel;

/**
 * Sprint 17: closure became two-phase. `createDraft` is called by the
 * review endpoint and persists a `status='draft'` row with the freshly
 * generated `aiFeedback` and a `reviewedAt` timestamp. `markSubmitted`
 * finalizes the same row when the user clicks Submit.
 */
export interface CreateDayClosureDraftData {
  userId: string;
  date: Date;
  aiFeedback: InputJsonValue;
}

/**
 * Returns ANY row (draft or submitted) for the user+date pair. Both Review
 * and Submit need to see drafts — this is one of the two intentionally
 * unfiltered read sites called out in Sprint 17 Phase 5.
 */
export function findByUserAndDate(
  userId: string,
  date: Date,
): Promise<DayClosureSubmission | null> {
  return prisma.dayClosureSubmission.findUnique({
    where: { userId_date: { userId, date } },
  });
}

export function createDraft(data: CreateDayClosureDraftData): Promise<DayClosureSubmission> {
  return prisma.dayClosureSubmission.create({
    data: {
      userId: data.userId,
      date: data.date,
      status: "draft",
      reviewedAt: new Date(),
      commentary: "",
      aiFeedback: data.aiFeedback,
      mediaIds: [],
    },
  });
}

export function markSubmitted(
  id: string,
  data: { commentary: string },
): Promise<DayClosureSubmission> {
  return prisma.dayClosureSubmission.update({
    where: { id },
    data: {
      status: "submitted",
      commentary: data.commentary,
      submittedAt: new Date(),
    },
  });
}

/**
 * Sprint 17 Phase 5: only finalized closures count as "submitted." Drafts
 * are in-progress and must NOT appear in activity feeds, dashboards, or any
 * manager-facing rollup.
 */
export function listSubmittedInRange(
  userId: string,
  from?: Date,
  to?: Date,
): Promise<DayClosureSubmission[]> {
  return prisma.dayClosureSubmission.findMany({
    where: {
      userId,
      status: "submitted",
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

export function findById(id: string): Promise<DayClosureSubmission | null> {
  return prisma.dayClosureSubmission.findUnique({ where: { id } });
}

/**
 * Sprint 17 Phase 5: filtered to `status='submitted'` so drafts never leak
 * into the unreviewed-closures inbox, consistency calculations, or any
 * manager-facing list.
 */
export function listForUsersInDateRange(
  userIds: string[],
  from: Date,
  to: Date,
): Promise<DayClosureSubmission[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return prisma.dayClosureSubmission.findMany({
    where: {
      userId: { in: userIds },
      status: "submitted",
      date: { gte: from, lte: to },
    },
    orderBy: [{ submittedAt: "desc" }],
  });
}
