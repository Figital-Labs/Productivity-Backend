/**
 * Meeting processing consumer (ADR-0025 · Producer–Consumer pattern). Pulls
 * "process-meeting" jobs from pg-boss, downloads the media from S3, and runs the slow
 * Vertex fusion via `meetingService.runProcessing`. Updates the `ProcessingJob` row so
 * the frontend's GET /jobs/:id poll reflects progress.
 *
 * RETRY TAXONOMY (ADR-0025 Phase 3) — three layers, each covering a different failure:
 *   1. `downloadOne`       — per-object S3 blips (3 tries, sub-second).
 *   2. `vertex.ts`         — within one execution, by failure class (see `classifyAiFailure`):
 *                            output errors retry instantly, transient ones back off 2s/10s/30s.
 *   3. this file           — across executions: a TRANSIENT failure that survives layer 2 is
 *                            re-queued minutes later rather than surfaced as an error.
 *
 * pg-boss's own `retryLimit` covers only a worker that genuinely DIED. It can never see an
 * application failure, because this handler must not rethrow: pg-boss fails the whole batch
 * (`fail(name, jobIds, err)`), which would take healthy sibling meetings down with the bad one.
 */
import type { Job, PgBoss } from "pg-boss";

import { env } from "../config/env.js";
import { modelFor } from "../lib/ai-config.js";
import { withTrace } from "../lib/langfuse.js";
import { errInfo, log } from "../lib/logger.js";
import { storage } from "../lib/storage/index.js";
import { classifyAiFailure } from "../lib/vertex.js";
import type { InlineMedia } from "../lib/vertex.js";
import * as jobRepo from "../repositories/job.repository.js";
import * as meetingService from "../services/meeting.service.js";

import { enqueueMeeting, MEETING_QUEUE } from "./queue.js";
import type { MeetingJobData } from "./queue.js";

// A long meeting (~5–6 hr) is ~130 small clips. Fetch them with bounded parallelism (faster than
// sequential, but capped so we don't open 130 S3 sockets or spike memory), and retry each download —
// one transient S3 blip among 130 must not fail the whole meeting.
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_PARALLELISM = 4;

/**
 * APP-LEVEL retry for TRANSIENT failures (Vertex 429/503, S3 5xx, dropped socket).
 *
 * `vertex.ts` already retries inside a single execution (2s/10s/30s on the `patient` profile),
 * but a Vertex quota window is per-minute — so when that budget is exhausted the right move is to
 * come back MINUTES later, not to surface an error the user has to clear by pressing Process
 * again. These delays are the gap before each subsequent execution.
 *
 * Bounded at MAX_JOB_ATTEMPTS so a persistently failing job can never loop forever.
 */
const MAX_JOB_ATTEMPTS = 3;
const RETRY_DELAYS_SECONDS = [60, 300];

async function downloadOne(key: string): Promise<InlineMedia> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { data, contentType } = await storage.download(key);
      return { buffer: data, mimeType: contentType };
    } catch (err) {
      lastErr = err;
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

async function downloadAll(keys: string[]): Promise<InlineMedia[]> {
  const media: InlineMedia[] = new Array<InlineMedia>(keys.length);
  let next = 0;
  const runLane = async (): Promise<void> => {
    while (next < keys.length) {
      const idx = next;
      next += 1;
      const key = keys[idx];
      if (key === undefined) continue;
      media[idx] = await downloadOne(key);
    }
  };
  const lanes = Math.min(DOWNLOAD_PARALLELISM, keys.length);
  await Promise.all(Array.from({ length: lanes }, runLane));
  return media;
}

async function processOne(job: Job<MeetingJobData>): Promise<void> {
  const { processingJobId, audioKeys, imageKeys, customPrompt } = job.data;
  const attempt = job.data.attempt ?? 1;
  const row = await jobRepo.findById(processingJobId);
  if (!row) {
    // status row gone (deleted?) — nothing to do; don't fail the batch.
    log.warn("worker", "job row missing", { jobId: processingJobId });
    return;
  }

  const ctx = { jobId: processingJobId, meetingId: row.targetId, userId: row.userId };
  log.info("worker", "processing", {
    ...ctx,
    audioKeys: audioKeys.length,
    imageKeys: imageKeys.length,
  });
  await jobRepo.markProcessing(processingJobId);
  try {
    // Langfuse: one trace per job execution (sessionId = meeting id, so re-queued attempts group).
    await withTrace(
      {
        name: "meeting-intent",
        service: "meeting-ai",
        userId: row.userId,
        sessionId: row.targetId,
        model: modelFor("meeting"),
        metadata: { jobId: processingJobId, attempt: String(attempt) },
        input: {
          audioKeys: audioKeys.length,
          imageKeys: imageKeys.length,
          hasCustomPrompt: customPrompt !== undefined,
        },
      },
      async () => {
        const audioClips = await downloadAll(audioKeys);
        const images = await downloadAll(imageKeys);
        log.debug("worker", "media downloaded", {
          ...ctx,
          clips: audioClips.length,
          images: images.length,
        });
        await meetingService.runProcessing(
          row.targetId,
          { id: row.userId, orgId: row.orgId },
          { audioClips, images, customPrompt },
        );
      },
    );
    await jobRepo.markSucceeded(processingJobId);
    log.info("worker", "succeeded", ctx);
  } catch (err) {
    // Never rethrow: pg-boss fails the ENTIRE batch on a handler throw
    // (`fail(name, jobIds, err)` in its manager), so one bad meeting would kill its siblings.
    // Retries are therefore driven here, at the application level, by re-enqueueing.
    const { message, stack } = errInfo(err);
    const kind = classifyAiFailure(err);
    const nextAttempt = attempt + 1;

    if (kind === "transient" && nextAttempt <= MAX_JOB_ATTEMPTS) {
      const delaySeconds = RETRY_DELAYS_SECONDS[attempt - 1] ?? 300;
      try {
        // Row goes back to `queued` FIRST so the FE keeps polling rather than flashing an error;
        // if the re-enqueue then throws we fall through and fail it properly below.
        await jobRepo.markQueuedForRetry(processingJobId, message);
        await enqueueMeeting(
          {
            processingJobId,
            audioKeys,
            imageKeys,
            attempt: nextAttempt,
            ...(customPrompt !== undefined ? { customPrompt } : {}),
          },
          { startAfterSeconds: delaySeconds },
        );
        log.warn("worker", "transient failure — re-queued", {
          ...ctx,
          attempt,
          nextAttempt,
          delaySeconds,
          message,
        });
        return;
      } catch (requeueErr) {
        // Re-enqueue failed — the row must NOT be left sitting in `queued` with nothing
        // scheduled to pick it up (the reconciler only rescues rows stuck in `processing`).
        log.error("worker", "re-queue failed", { ...ctx, ...errInfo(requeueErr) });
      }
    }

    await jobRepo.markFailed(processingJobId, message);
    log.error("worker", "failed", { ...ctx, kind, attempt, message, stack });
  }
}

export async function registerMeetingWorker(boss: PgBoss): Promise<void> {
  await boss.work<MeetingJobData>(
    MEETING_QUEUE,
    { batchSize: env.meetingWorkerConcurrency },
    async (jobs) => {
      await Promise.all(jobs.map(processOne));
    },
  );
}
