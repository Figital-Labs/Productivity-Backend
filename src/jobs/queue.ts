/**
 * pg-boss job queue (ADR-0025). Backs async meeting + capture processing on the EXISTING Postgres —
 * no Redis. One PgBoss instance per process (singleton, like `prisma`). For our deploy the
 * web process starts BOTH the HTTP server and this consumer in-process (single process on
 * EC2); `src/worker.ts` remains an alternate entrypoint for a future dedicated-worker split.
 *
 * CONNECTION: pg-boss must use a session-mode (direct/unpooled) connection. Its LISTEN/NOTIFY
 * and advisory locks break under a transaction pooler (e.g. Neon's `-pooler` endpoint) →
 * ghost listeners / duplicate job execution. We connect via `env.directDatabaseUrl` and
 * refuse a pooled URL outright at boot.
 */
import { PgBoss } from "pg-boss";

import { env } from "../config/env.js";
import { AI_TIMEOUT_MS } from "../lib/ai-config.js";
import { errInfo, log } from "../lib/logger.js";

export const MEETING_QUEUE = "process-meeting";
export const CAPTURE_QUEUE = "process-capture";

export interface MeetingJobData {
  processingJobId: string;
  audioKeys: string[];
  imageKeys: string[];
  customPrompt?: string;
}

/**
 * Voice / image task-capture job. A single short clip or image already lives in S3 under `key`;
 * the worker downloads it, runs the same Vertex extraction the old synchronous endpoints did, and
 * fills in the pre-created interaction row (`interactionId`). `targetDate` anchors the AI's TODAY
 * and the dispatcher's default date.
 */
export interface CaptureJobData {
  processingJobId: string;
  surface: "voice" | "image";
  key: string;
  interactionId: string;
  targetDate?: string;
}

// Visibility timeout must exceed the longest AI call (meeting ceiling) so pg-boss never
// treats an in-flight job as stalled. +120s headroom for S3 download + DB writes.
const MEETING_EXPIRE_SECONDS = Math.ceil(AI_TIMEOUT_MS.meeting / 1000) + 120;
// Captures use the (shorter) media ceiling; same +120s headroom for download + dispatch writes.
const CAPTURE_EXPIRE_SECONDS = Math.ceil(AI_TIMEOUT_MS.media / 1000) + 120;

// Fail fast on a transaction-pooler URL — pg-boss silently misbehaves on it.
if (env.directDatabaseUrl.includes("-pooler")) {
  console.error(
    "FATAL: pg-boss cannot use a transaction-pooler (`-pooler`) connection — LISTEN/NOTIFY " +
      "and advisory locks break. Set DIRECT_DATABASE_URL to the direct/unpooled endpoint.",
  );
  process.exit(1);
}

const boss = new PgBoss(env.directDatabaseUrl);
let startPromise: Promise<PgBoss> | null = null;

/** Start pg-boss once per process (idempotent across concurrent callers). */
export function startQueue(): Promise<PgBoss> {
  startPromise ??= (async () => {
    // pg-boss emits background (maintenance / transient connection) errors here — they are NOT
    // generally fatal, and crashing the whole in-process web server on each one risks a restart
    // loop on a brief DB blip. Log loudly; pg-boss reconnects on its own, and the container's
    // health check + orchestrator handle a truly dead process.
    boss.on("error", (err: unknown) => {
      log.error("queue", "pg-boss background error", errInfo(err));
    });
    await boss.start();
    await boss.createQueue(MEETING_QUEUE);
    await boss.createQueue(CAPTURE_QUEUE);
    return boss;
  })();
  return startPromise;
}

/** Producer side: enqueue a meeting for out-of-band processing. */
export async function enqueueMeeting(data: MeetingJobData): Promise<void> {
  const started = await startQueue();
  await started.send(MEETING_QUEUE, data, { expireInSeconds: MEETING_EXPIRE_SECONDS });
}

/** Producer side: enqueue a voice/image capture for out-of-band processing. */
export async function enqueueCapture(data: CaptureJobData): Promise<void> {
  const started = await startQueue();
  await started.send(CAPTURE_QUEUE, data, { expireInSeconds: CAPTURE_EXPIRE_SECONDS });
}

/** Stop the queue (drains in-flight work) — called from the in-process graceful shutdown. */
export async function stopQueue(): Promise<void> {
  if (startPromise === null) return;
  await boss.stop();
}
