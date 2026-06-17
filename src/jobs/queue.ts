/**
 * pg-boss job queue (ADR-0025). Backs async media processing on the EXISTING Postgres —
 * no Redis. One PgBoss instance per process (singleton, like `prisma`); both the web
 * process (producer, via `enqueueMeeting`) and the worker (consumer, `src/worker.ts`)
 * call `startQueue()` to boot it. pg-boss manages its own `pgboss` schema in the DB.
 */
import { PgBoss } from "pg-boss";

import { env } from "../config/env.js";
import { AI_TIMEOUT_MS } from "../lib/ai-config.js";

export const MEETING_QUEUE = "process-meeting";

export interface MeetingJobData {
  processingJobId: string;
  audioKeys: string[];
  imageKeys: string[];
  customPrompt?: string;
}

// Visibility timeout must exceed the longest AI call (meeting ceiling) so pg-boss never
// treats an in-flight 20-min job as stalled. +120s headroom for S3 download + DB writes.
const MEETING_EXPIRE_SECONDS = Math.ceil(AI_TIMEOUT_MS.meeting / 1000) + 120;

const boss = new PgBoss(env.databaseUrl);
let startPromise: Promise<PgBoss> | null = null;

/** Start pg-boss once per process (idempotent across concurrent callers). */
export function startQueue(): Promise<PgBoss> {
  startPromise ??= (async () => {
    await boss.start();
    await boss.createQueue(MEETING_QUEUE);
    return boss;
  })();
  return startPromise;
}

/** Producer side: enqueue a meeting for out-of-band processing. */
export async function enqueueMeeting(data: MeetingJobData): Promise<void> {
  const started = await startQueue();
  await started.send(MEETING_QUEUE, data, { expireInSeconds: MEETING_EXPIRE_SECONDS });
}
