---
id: ADR-0025
title: Async media processing (Postgres-backed queue + worker)
status: accepted
date: 2026-06-17
tags: [infrastructure, ai, scalability]
related: [ADR-0023, ADR-0017, ADR-0001]
---

# ADR-0025: Async Media Processing (Postgres-Backed Queue + Worker)

## Context

Meeting "Send to AI" (`POST /meetings/:id/process`) ran the Vertex AI fusion
**synchronously inside the Express request**. A meeting can carry up to 12 audio clips +
4 images (~160 MB held in process RAM) and the model call can take **up to 20 minutes**
(`AI_TIMEOUT_MS.meeting = 1_200_000`), propped up by a 300s socket-timeout hack. Any
load-balancer / proxy / dyno timeout or dropped connection lost the work with no recovery,
because the media bytes were never persisted. This is the single biggest scaling/
reliability risk in the backend.

Object storage is now real (ADR-0023): S3 credentials landed, so media can be persisted
durably instead of discarded.

This is **Phase 1** of the media-pipeline plan (see `.agents/media-pipeline.md`). Phases 2
(presigned direct-to-S3 upload) and 3 (idempotency-key wiring, retry/backoff/dead-letter,
retry-from-S3) are deferred.

## Decision

Decouple the slow meeting flow from the HTTP request:

1. The controller uploads each media buffer to **S3** (via the `BlobStorage` seam,
   ADR-0023), creates a `ProcessingJob` status row, enqueues a job, and returns
   **`202 { jobId, meetingId, status }`** immediately.
2. A separate **worker process** (`src/worker.ts`, run as `npm run worker` /
   `node dist/worker.js`) consumes the queue, downloads the media from S3, runs the Vertex
   fusion (`meetingService.runProcessing`), and writes the result.
3. The frontend **polls `GET /jobs/:id`** until the job reaches `succeeded` / `failed`,
   then re-fetches `GET /meetings/:id`.

**Queue = `pg-boss` on the existing Postgres — no Redis.** **Only meetings go async**;
voice / image / transcribe stay synchronous (they are sub-30s and a user is actively
waiting on the result).

## Reasoning

- **pg-boss over Redis/BullMQ or SQS.** Meeting volume is low and we already run Postgres,
  so a Postgres-backed queue adds **zero new infrastructure**, supports the same
  retries/backoff/dead-letter features, and lets the enqueue sit next to our own data.
  Redis/BullMQ and SQS are built for throughput we do not have. Ladder up only if job
  volume ever outgrows one Postgres — the worker + status design is identical either way.
- **Meetings-only async.** Async is a win when the work is slow enough that holding the
  request is fragile. For sub-30s interactive flows where the user waits on what they just
  did, synchronous is both simpler and better UX. (Industry-standard split.)
- **Status in Postgres (`ProcessingJob`), separate from queue mechanics.** Durable and
  pollable independent of the queue; the FE polls one stable read model.
- **Polling over SSE/WebSocket.** Zero new infra, no sticky-session / LB concerns; a job
  polled every ~2s is negligible load next to a multi-minute AI call.
- **S3, with a worker-side download.** Gemini on Vertex cannot read `s3://` URIs, so the
  worker pulls the bytes and passes them inline (reusing `buildParts`). See ADR-0026 to
  revisit GCS (`gs://` is natively readable) if worker RAM/latency becomes a concern.

## Alternatives Considered

- **BullMQ + Redis** — rejected: a whole new service to run/secure/monitor for throughput
  we do not have.
- **AWS SQS** — rejected: overkill, weaker TS ergonomics, no result store.
- **All media flows async** — rejected: worse UX for quick clips; more surface for no
  near-term benefit.
- **Stay synchronous with longer proxy timeouts** — rejected: fragile; loses work on any
  dropped connection; holds buffers + request threads.

## Consequences

- **New deps:** `pg-boss`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- **New env:** `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `MEDIA_KEY_PREFIX`, `WORKER_CONCURRENCY`.
- **New process type:** the worker. Deployment must run `node dist/worker.js` alongside
  the web process (both against the same Postgres). Stateless web tier is unchanged.
- **New model:** `ProcessingJob` (migration `add_processing_job`). pg-boss also creates its
  own `pgboss` schema in the DB on first `start()`.
- **Meeting media is now persisted to S3** (was discarded). A lifecycle policy to expire
  raw media is deferred to Phase 5.
- **Idempotency:** double-tap is guarded by an active-job lookup
  (`jobRepo.findActiveByTarget`). Header-based `Idempotency-Key` (ADR-0017) wiring is
  Phase 3.
- **Retry posture (Phase 1):** AI/processing failures are caught and recorded on the row
  (the FE surfaces them); pg-boss's default policy retries on infra/transport errors. A
  formal retry/backoff/dead-letter taxonomy is Phase 3.

## Revisit If

- Meeting throughput outgrows one Postgres → reconsider Redis/BullMQ or SQS.
- Worker RAM / latency from the S3 download shows up in metrics → ADR-0026 (GCS, native
  `gs://`).
- Voice / image / transcribe start hitting timeouts → extend the same pattern to them
  (the worker + status model generalize via the `kind` field).

## Wiring

Referenced from the code headers it governs (`src/jobs/queue.ts`, `src/worker.ts`,
`src/jobs/meeting.worker.ts`, `src/services/job.service.ts`, `src/repositories/job.repository.ts`,
`ProcessingJob` in `prisma/schema.prisma`), from `.agents/media-pipeline.md` (the
end-to-end flow), and from the root `Wavesprint.md` master plan.
