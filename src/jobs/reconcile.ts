import { jobBudgetSeconds } from "../lib/ai-config.js";
import { errInfo, log } from "../lib/logger.js";
import * as jobRepo from "../repositories/job.repository.js";

/**
 * Startup reconciler. A worker that dies mid-job (OOM / crash / redeploy) leaves its `ProcessingJob`
 * row stuck in `processing` — pg-boss re-dispatches the queue job on its own visibility timeout, but
 * the status row would otherwise never resolve and the frontend would poll it forever. Here we fail
 * any row whose processing began longer ago than the worst-case budget. We use the LARGEST (meeting)
 * budget as a universal cutoff so a legitimately in-flight job of any kind is never killed.
 */
export async function reconcileStuckJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - jobBudgetSeconds("meeting") * 1000);
  try {
    const count = await jobRepo.failStaleProcessing(
      cutoff,
      "Processing didn't finish in time (the server restarted). Please try again.",
    );
    if (count > 0) log.warn("queue", "reconciled stuck jobs", { count });
  } catch (err) {
    log.error("queue", "stuck-job reconcile failed", errInfo(err));
  }
}
