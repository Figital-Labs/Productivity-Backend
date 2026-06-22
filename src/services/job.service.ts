import { NotFoundError } from "../lib/errors.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as jobRepo from "../repositories/job.repository.js";

export interface JobStatusView {
  id: string;
  kind: string;
  status: string;
  targetType: string;
  targetId: string;
  error: string | null;
}

/**
 * Status for the frontend poll (ADR-0025). Owner-scoped: the caller must be the user who
 * created the job (meetings are processed by their creator). Returns 404 otherwise — no
 * existence leak.
 */
export async function getJobStatus(caller: AuthenticatedUser, id: string): Promise<JobStatusView> {
  const job = await jobRepo.findById(id);
  if (job?.userId !== caller.id) {
    throw new NotFoundError("Job");
  }
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    targetType: job.targetType,
    targetId: job.targetId,
    error: job.error,
  };
}
