/**
 * Capture processing consumer (ADR-0025) — the voice/image twin of `meeting.worker`. Pulls
 * "process-capture" jobs, downloads the single clip/image from S3, rebuilds the owning user's
 * auth context (so task dispatch + access checks behave exactly as on the request path), and runs
 * the surface's extraction service. Failures are caught per job and recorded on the `ProcessingJob`
 * row so the frontend's GET /jobs/:id poll surfaces them.
 */
import type { Job, PgBoss } from "pg-boss";

import { env } from "../config/env.js";
import { modelFor } from "../lib/ai-config.js";
import { loadAuthenticatedUser } from "../lib/auth-context.js";
import { withTrace } from "../lib/langfuse.js";
import { errInfo, log } from "../lib/logger.js";
import { storage } from "../lib/storage/index.js";
import * as jobRepo from "../repositories/job.repository.js";
import * as imageService from "../services/image-extraction.service.js";
import * as voiceService from "../services/voice-intent.service.js";

import { CAPTURE_QUEUE } from "./queue.js";
import type { CaptureJobData } from "./queue.js";

async function processOne(job: Job<CaptureJobData>): Promise<void> {
  const { processingJobId, surface, key, interactionId, targetDate } = job.data;
  const row = await jobRepo.findById(processingJobId);
  if (!row) {
    log.warn("capture-worker", "job row missing", { jobId: processingJobId });
    return;
  }

  const ctx = { jobId: processingJobId, surface, interactionId, userId: row.userId };
  log.info("capture-worker", "processing", ctx);
  await jobRepo.markProcessing(processingJobId);
  try {
    const user = await loadAuthenticatedUser(row.userId);
    if (!user) throw new Error(`User ${row.userId} no longer exists`);
    const { data, contentType } = await storage.download(key);
    const media = { buffer: data, mimeType: contentType };
    const input = targetDate !== undefined ? { targetDate } : {};
    // Langfuse: one trace per job (sessionId = the voice/image interaction id).
    await withTrace(
      {
        name: surface === "voice" ? "voice-intent" : "image-intent",
        service: "personal-capture",
        userId: row.userId,
        sessionId: interactionId,
        model: modelFor("extraction"),
        metadata: { jobId: processingJobId },
        input: { mimeType: contentType, bytes: data.length },
      },
      async () => {
        if (surface === "voice") {
          await voiceService.runVoiceProcessing(user, media, input, interactionId);
        } else {
          await imageService.runImageProcessing(user, media, input, interactionId);
        }
      },
    );
    await jobRepo.markSucceeded(processingJobId);
    log.info("capture-worker", "succeeded", ctx);
  } catch (err) {
    // Isolate the failure to this job (the FE sees it via the ProcessingJob row); don't rethrow so
    // a sibling job in the same batch still completes. The S3 object survives for a cheap retry.
    const { message, stack } = errInfo(err);
    await jobRepo.markFailed(processingJobId, message);
    log.error("capture-worker", "failed", { ...ctx, message, stack });
  }
}

export async function registerCaptureWorker(boss: PgBoss): Promise<void> {
  await boss.work<CaptureJobData>(
    CAPTURE_QUEUE,
    { batchSize: env.captureWorkerConcurrency },
    async (jobs) => {
      await Promise.all(jobs.map(processOne));
    },
  );
}
