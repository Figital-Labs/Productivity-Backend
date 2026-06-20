/**
 * Producer side of voice/image task capture (async pipeline, ADR-0025) — the capture twin of
 * `meeting.service`. The browser presigns + uploads the clip/image straight to S3, then hands us
 * the key; we pre-create the interaction row, create a `ProcessingJob`, and enqueue a pg-boss job.
 * The worker (`capture.worker`) downloads the object and runs the Vertex extraction. A byte
 * fallback (raw `bytes`) covers the disk dev driver / S3 CORS, uploading server-side here instead.
 */
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { enqueueCapture as enqueueCaptureJob } from "../jobs/queue.js";
import { AppError, NotFoundError, ValidationError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { storage } from "../lib/storage/index.js";
import type { PresignedUpload } from "../lib/storage/index.js";
import { buildMediaKey, isSupportedMediaMime, mediaKeyPrefix } from "../lib/storage/keys.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as imageRepo from "../repositories/image.repository.js";
import * as jobRepo from "../repositories/job.repository.js";
import * as voiceRepo from "../repositories/voice.repository.js";
import type { CaptureSurface } from "../schemas/capture.schema.js";
import type { ImageRecommendation } from "../schemas/image-extraction.schema.js";
import type { VoiceRecommendation } from "../schemas/voice-intent.schema.js";

import type { PersistedAiAction } from "./action-dispatch.service.js";
import type { ImageProcessResult } from "./image-extraction.service.js";
import type { VoiceProcessResult } from "./voice-intent.service.js";

export interface CaptureEnqueueResult {
  jobId: string;
  interactionId: string;
  status: string;
}

export interface CaptureBytes {
  buffer: Buffer;
  mimeType: string;
}

/** Reject a clip presented under the wrong surface (audio for "voice", image for "image"). */
function assertSurfaceMime(surface: CaptureSurface, baseType: string): void {
  const ok = surface === "voice" ? baseType.startsWith("audio/") : baseType.startsWith("image/");
  if (!ok) {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      400,
      `"${baseType}" is not a valid media type for ${surface} capture.`,
    );
  }
}

/**
 * Direct-to-S3: a presigned POST so the browser uploads a capture clip/image straight to S3. The
 * key is server-minted under the caller's `<surface>/<orgId>/<userId>/` prefix (the client can't
 * choose it). Returns 503 when the driver can't presign — the client falls back to a byte upload.
 */
export async function presignCapture(
  caller: AuthenticatedUser,
  surface: CaptureSurface,
  contentType: string,
): Promise<PresignedUpload> {
  const baseType = contentType.split(";")[0]?.trim() ?? "";
  if (!isSupportedMediaMime(baseType)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", 400, `Unsupported media type "${contentType}".`);
  }
  assertSurfaceMime(surface, baseType);
  const key = buildMediaKey(surface, caller.orgId, caller.id, baseType);
  const presigned = await storage.createPresignedUpload(key, baseType);
  if (presigned === null) {
    throw new AppError("STORAGE_NOT_CONFIGURED", 503, "Direct upload is not available.");
  }
  return presigned;
}

/** Pre-create the (empty) interaction row that the worker will fill; returns its id. */
async function createPendingInteraction(
  surface: CaptureSurface,
  userId: string,
  key: string,
): Promise<string> {
  if (surface === "voice") {
    const row = await voiceRepo.create({
      userId,
      transcript: "",
      actions: [] as InputJsonValue,
      recommendations: [] as InputJsonValue,
      audioUrl: key,
    });
    return row.id;
  }
  const row = await imageRepo.create({
    userId,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
    imageUrl: key,
  });
  return row.id;
}

/**
 * Producer side: resolve the media key (direct-uploaded or byte-fallback), pre-create the
 * interaction row + `ProcessingJob`, and enqueue. Returns immediately so the controller can answer
 * 202. Idempotent on the upload key — a retried submit for the same object returns the live job.
 */
export async function enqueueCapture(
  caller: AuthenticatedUser,
  surface: CaptureSurface,
  input: { key?: string; bytes?: CaptureBytes; targetDate?: string },
): Promise<CaptureEnqueueResult> {
  let key: string;
  if (input.key !== undefined) {
    // Anti-tamper: a submitted key must live under THIS caller's surface prefix.
    if (!input.key.startsWith(mediaKeyPrefix(surface, caller.orgId, caller.id))) {
      throw new ValidationError("Upload key does not belong to you.");
    }
    key = input.key;
  } else if (input.bytes !== undefined) {
    const baseType = input.bytes.mimeType.split(";")[0]?.trim() ?? "";
    assertSurfaceMime(surface, baseType);
    key = buildMediaKey(surface, caller.orgId, caller.id, baseType);
    await storage.upload(key, input.bytes.buffer, {
      contentType: input.bytes.mimeType,
      contentLength: input.bytes.buffer.length,
    });
  } else {
    throw new ValidationError("A capture requires either an upload key or a file.");
  }

  // Idempotency: a retried submit for the same uploaded object returns the in-flight job.
  const active = await jobRepo.findActiveByMediaKey(key);
  if (active) {
    return { jobId: active.id, interactionId: active.targetId, status: active.status };
  }

  const interactionId = await createPendingInteraction(surface, caller.id, key);

  const job = await jobRepo.create({
    orgId: caller.orgId,
    userId: caller.id,
    kind: surface,
    targetType: surface,
    targetId: interactionId,
    mediaKeys: [key],
  });

  log.info("capture", "enqueued", { surface, userId: caller.id, jobId: job.id, interactionId });

  try {
    await enqueueCaptureJob({
      processingJobId: job.id,
      surface,
      key,
      interactionId,
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobRepo.markFailed(job.id, message);
    log.error("capture", "enqueue failed", { surface, jobId: job.id, message });
    throw err;
  }

  return { jobId: job.id, interactionId, status: job.status };
}

/**
 * Owner-scoped read of a finished (or pre-created) capture row — the FE fetches this once the job
 * poll reports `succeeded`. Returns the same shape the old synchronous endpoints did, so the modal
 * renders tasks + suggestions unchanged.
 */
export async function getCaptureResult(
  caller: AuthenticatedUser,
  surface: CaptureSurface,
  id: string,
): Promise<VoiceProcessResult | ImageProcessResult> {
  if (surface === "voice") {
    const row = await voiceRepo.findById(id);
    if (row?.userId !== caller.id) throw new NotFoundError("Capture");
    return {
      voiceInteractionId: row.id,
      transcript: row.transcript,
      actions: (row.actions ?? []) as PersistedAiAction[],
      recommendations: (row.recommendations ?? []) as VoiceRecommendation[],
    };
  }
  const row = await imageRepo.findById(id);
  if (row?.userId !== caller.id) throw new NotFoundError("Capture");
  return {
    imageExtractionId: row.id,
    extractedText: row.extractedText ?? "",
    actions: (row.actions ?? []) as PersistedAiAction[],
    recommendations: (row.recommendations ?? []) as ImageRecommendation[],
  };
}
