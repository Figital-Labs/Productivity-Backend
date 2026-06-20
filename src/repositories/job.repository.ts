import type { ProcessingJobModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";

export type ProcessingJob = ProcessingJobModel;

export interface CreateProcessingJobData {
  orgId: string;
  userId: string;
  kind: string;
  targetType: string;
  targetId: string;
  mediaKeys: string[];
}

export function create(data: CreateProcessingJobData): Promise<ProcessingJob> {
  return prisma.processingJob.create({ data });
}

export function findById(id: string): Promise<ProcessingJob | null> {
  return prisma.processingJob.findUnique({ where: { id } });
}

/**
 * Active (queued|processing) job for a target — used to make enqueue idempotent: a
 * double-tap on "Send to AI" returns the existing job instead of starting a second.
 */
export function findActiveByTarget(
  targetType: string,
  targetId: string,
): Promise<ProcessingJob | null> {
  return prisma.processingJob.findFirst({
    where: { targetType, targetId, status: { in: ["queued", "processing"] } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Active (queued|processing) job that already owns this media key — makes capture enqueue
 * idempotent: a retried `/captures/process` for the same uploaded object returns the existing
 * job instead of starting a second. (Captures have no parent resource to dedup by, so we dedup
 * on the S3 key itself.)
 */
export function findActiveByMediaKey(key: string): Promise<ProcessingJob | null> {
  return prisma.processingJob.findFirst({
    where: { mediaKeys: { has: key }, status: { in: ["queued", "processing"] } },
    orderBy: { createdAt: "desc" },
  });
}

export function markProcessing(id: string): Promise<ProcessingJob> {
  return prisma.processingJob.update({
    where: { id },
    data: { status: "processing", startedAt: new Date() },
  });
}

export function markSucceeded(id: string): Promise<ProcessingJob> {
  return prisma.processingJob.update({
    where: { id },
    data: { status: "succeeded", finishedAt: new Date(), error: null },
  });
}

export function markFailed(id: string, error: string): Promise<ProcessingJob> {
  return prisma.processingJob.update({
    where: { id },
    data: { status: "failed", finishedAt: new Date(), error },
  });
}
