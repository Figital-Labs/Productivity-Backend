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

/**
 * Hand a job back to the queue after a TRANSIENT failure (Vertex 429/503, S3 5xx, socket drop).
 *
 * Returning to `queued` — not `failed` — is what keeps the frontend polling instead of showing an
 * error, since it treats `queued|processing` as "still working". `startedAt` is cleared so the
 * startup reconciler (which only fails rows stuck in `processing`) can't mistake a waiting job for
 * an orphan. The last error is retained purely for diagnostics; the FE only surfaces `error` once
 * the status is `failed`.
 *
 * Caller MUST re-enqueue after this, and mark the job failed if that enqueue throws — otherwise
 * the row sits in `queued` with nothing scheduled to pick it up.
 */
export function markQueuedForRetry(id: string, error: string): Promise<ProcessingJob> {
  return prisma.processingJob.update({
    where: { id },
    data: { status: "queued", startedAt: null, error },
  });
}

/**
 * Fail any job stuck in `processing` since before `startedBefore` — orphans left by a worker that
 * died mid-job (OOM/crash). Without this the status row never resolves and the FE polls forever.
 * Callers pass the worst-case (largest) job budget as the cutoff so a legitimately in-flight job is
 * never killed. Returns the number of rows reset.
 */
export async function failStaleProcessing(startedBefore: Date, error: string): Promise<number> {
  const result = await prisma.processingJob.updateMany({
    where: { status: "processing", startedAt: { lt: startedBefore } },
    data: { status: "failed", finishedAt: new Date(), error },
  });
  return result.count;
}
