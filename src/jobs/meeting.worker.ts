/**
 * Meeting processing consumer (ADR-0025 · Producer–Consumer pattern). Pulls
 * "process-meeting" jobs from pg-boss, downloads the media from S3, and runs the slow
 * Vertex fusion via `meetingService.runProcessing`. Updates the `ProcessingJob` row so
 * the frontend's GET /jobs/:id poll reflects progress. AI/processing failures are caught
 * per job and recorded on the row (the FE surfaces them); pg-boss's default policy still
 * retries on infra/transport errors. ADR-0025 Phase 3 formalizes the retry taxonomy.
 */
import type { Job, PgBoss } from "pg-boss";

import { env } from "../config/env.js";
import { storage } from "../lib/storage/index.js";
import type { InlineMedia } from "../lib/vertex.js";
import * as jobRepo from "../repositories/job.repository.js";
import * as meetingService from "../services/meeting.service.js";

import { MEETING_QUEUE } from "./queue.js";
import type { MeetingJobData } from "./queue.js";

async function downloadAll(keys: string[]): Promise<InlineMedia[]> {
  const media: InlineMedia[] = [];
  for (const key of keys) {
    const { data, contentType } = await storage.download(key);
    media.push({ buffer: data, mimeType: contentType });
  }
  return media;
}

async function processOne(job: Job<MeetingJobData>): Promise<void> {
  const { processingJobId, audioKeys, imageKeys, customPrompt } = job.data;
  const row = await jobRepo.findById(processingJobId);
  if (!row) return; // status row gone (deleted?) — nothing to do; don't fail the batch.

  await jobRepo.markProcessing(processingJobId);
  try {
    const audioClips = await downloadAll(audioKeys);
    const images = await downloadAll(imageKeys);
    await meetingService.runProcessing(
      row.targetId,
      { id: row.userId, orgId: row.orgId },
      { audioClips, images, customPrompt },
    );
    await jobRepo.markSucceeded(processingJobId);
  } catch (err) {
    // Isolate the failure to this job (the FE sees it via the ProcessingJob row) and don't
    // rethrow, so a sibling job in the same batch still completes.
    await jobRepo.markFailed(processingJobId, err instanceof Error ? err.message : String(err));
  }
}

export async function registerMeetingWorker(boss: PgBoss): Promise<void> {
  await boss.work<MeetingJobData>(
    MEETING_QUEUE,
    { batchSize: env.workerConcurrency },
    async (jobs) => {
      await Promise.all(jobs.map(processOne));
    },
  );
}
