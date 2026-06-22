# Media Pipeline — Storage + Async AI Processing

> **Start here** if you're touching audio/image upload, meeting processing, S3, or the job
> queue. Decision record: **[ADR-0025](./decisions/0025-async-media-processing.md)**
> (async processing) + **[ADR-0023](./decisions/0023-s3-storage.md)** (S3 storage).
> Master plan: root `Wavesprint.md`.

## What this is

Audio/images are stored durably in **S3**, and the slow **meeting** AI processing runs in
a **separate worker** off the HTTP request, coordinated by a **`pg-boss` queue on the
existing Postgres** (no Redis). The frontend polls a status endpoint.

Voice / image / transcribe are **still synchronous** (sub-30s, user is waiting) — only
meetings are async. The worker + status model are written generically (`kind` field) so
those flows can be moved later without a rewrite.

## End-to-end flow (a meeting "Send to AI")

```
Browser (Task-List)
  POST /api/v1/meetings/:id/process   (multipart: audio[] + images[] + notes)
        │
        ▼
meeting.controller.processMeeting
  → meetingService.enqueueProcessing
        guards (ownership, already-processed, processability, attendees)
        persist notes
        storage.upload(buffer) ──────────► S3  (media/<orgId>/<userId>/<uuid>.<ext>)
        jobRepo.create(ProcessingJob status=queued)
        enqueueMeeting(boss.send "process-meeting", { processingJobId, audioKeys, imageKeys })
  ◄── 202 { jobId, meetingId, status:"queued" }
        │
        │  (frontend polls GET /api/v1/jobs/:id every ~2s)
        ▼
Worker process (node dist/worker.js)  ── pulls "process-meeting" from pg-boss
  meeting.worker.processOne
        jobRepo.markProcessing
        storage.download(key) ◄────────── S3   (Gemini can't read s3://, so we re-inline)
        meetingService.runProcessing → generateStructured(Vertex Gemini)
        meetingRepo.recordProcessed(summary, recommendations)
        jobRepo.markSucceeded   (or markFailed on error)
        │
        ▼
Browser sees status:"succeeded" → GET /api/v1/meetings/:id  (hydrated result)
```

## Where each piece lives

| Concern | File |
|---|---|
| Storage seam (`BlobStorage`) + singleton | `src/lib/storage/index.ts` |
| S3 implementation | `src/lib/storage/s3.ts` |
| Key namespacing (`media/<org>/<user>/<uuid>.<ext>`) | `src/lib/storage/keys.ts` |
| Queue (pg-boss singleton, `enqueueMeeting`) | `src/jobs/queue.ts` |
| Worker entrypoint (separate process) | `src/worker.ts` |
| Meeting consumer (download → run → mark) | `src/jobs/meeting.worker.ts` |
| Producer/consumer split | `src/services/meeting.service.ts` (`enqueueProcessing` / `runProcessing`) |
| 202 controller | `src/controllers/meeting.controller.ts` |
| Status row model | `ProcessingJob` in `prisma/schema.prisma` |
| Status endpoint `GET /jobs/:id` | `src/routes/jobs.routes.ts` → `controllers/job.controller.ts` → `services/job.service.ts` → `repositories/job.repository.ts` |
| Frontend poll + UI | `Task-List/src/api/meetings.ts` (`process`/`getJob`/`pollJob`), `components/meetings/ProcessingProgressModal.tsx` |

## Design patterns (and where)

- **Singleton** — `storage` (`lib/storage/index.ts`) and the pg-boss instance
  (`jobs/queue.ts`), same discipline as `prisma`.
- **Strategy + Adapter** — `BlobStorage` ← `S3Storage`; a future `GcsStorage` swaps one
  file (ADR-0026).
- **Producer–Consumer / queue-based load leveling** — controller `enqueueMeeting` →
  worker `boss.work`.
- **Durable status store (CQRS-lite)** — `ProcessingJob` is the pollable read model,
  separate from pg-boss's own job state.
- **Repository** — `job.repository.ts` is the only place `prisma.processingJob` is touched.

## Env vars

```
AWS_REGION, AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   # S3 (required)
MEDIA_KEY_PREFIX=media                                                  # key namespace
WORKER_CONCURRENCY=2                                                    # jobs per worker poll
```

The queue reuses `DATABASE_URL`. There is **no Redis**.

## Running it

```bash
npm run db:migrate            # apply the add_processing_job migration (once)
npm run dev                   # web (http://localhost:8000)
npm run worker                # worker — REQUIRED for meetings to process
```

Both processes run against the same Postgres. pg-boss creates its own `pgboss` schema on
first start. Production: `npm start` + `npm run worker:start` as two process types.

## Verifying

1. Process a meeting in the app → the request returns **202 in <1s** (no long hang).
2. `GET /api/v1/jobs/:id` transitions `queued → processing → succeeded`.
3. The object exists in the `lnd-audio-dev` bucket under `media/<org>/<user>/...`.
4. **Kill the web process** mid-job → the worker still finishes it (job + status in
   Postgres, media in S3). Restart web; the meeting shows its summary.
5. Voice / image / transcribe still respond inline (unchanged).

## Deferred (later phases — ADR-0025)

- **Phase 2** — presigned direct-to-S3 upload (`POST /media/presign`); browser PUTs to S3,
  backend never holds the bytes.
- **Phase 3** — header `Idempotency-Key` (ADR-0017), pg-boss retry/backoff/dead-letter,
  `POST /jobs/:id/retry` (retry from the persisted S3 object), sync-flow durability.
- **Phase 5** — S3 lifecycle expiry for raw media; GCS reconsideration (ADR-0026).
