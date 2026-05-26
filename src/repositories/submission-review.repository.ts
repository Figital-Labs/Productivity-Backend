import type { SubmissionReviewModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type SubmissionReview = SubmissionReviewModel;
export type SubmissionKind = "plan" | "closure";

export function createReview(
  submissionId: string,
  kind: SubmissionKind,
  reviewerId: string,
): Promise<SubmissionReview> {
  return prisma.submissionReview.create({
    data: { submissionId, submissionKind: kind, reviewerId },
  });
}

export function findReview(
  submissionId: string,
  kind: SubmissionKind,
  reviewerId: string,
): Promise<SubmissionReview | null> {
  return prisma.submissionReview.findUnique({
    where: {
      submissionId_submissionKind_reviewerId: { submissionId, submissionKind: kind, reviewerId },
    },
  });
}

export function listForReviewer(
  submissionIds: string[],
  kind: SubmissionKind,
  reviewerId: string,
): Promise<SubmissionReview[]> {
  if (submissionIds.length === 0) return Promise.resolve([]);
  return prisma.submissionReview.findMany({
    where: { submissionId: { in: submissionIds }, submissionKind: kind, reviewerId },
  });
}
