# Deploy — backend (single-process, EC2 / Fargate)

The backend runs as **one process**: the HTTP server plus the pg-boss meeting worker
**in-process** (`RUN_WORKER_IN_PROCESS=true`, the default). One container does everything.

## Required environment

| Var                                                                            | Notes                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                 | App (Prisma) connection. On Neon use the **pooled** (`-pooler`) endpoint.                                                                                                                                                                                                                                 |
| `DIRECT_DATABASE_URL`                                                          | **pg-boss** connection — must be the **direct/unpooled** endpoint (port 5432, no `-pooler`). pg-boss's LISTEN/NOTIFY + advisory locks break under a transaction pooler. Boot **fails fast** if this resolves to a `-pooler` URL. If unset, falls back to `DATABASE_URL` (fine for a non-pooled/local DB). |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Vertex AI.                                                                                                                                                                                                                                                                                                |
| `JWT_SECRET`                                                                   | ≥ 32 chars.                                                                                                                                                                                                                                                                                               |
| `STORAGE_DRIVER`                                                               | `s3` (default, prod) or `disk` (local dev, no AWS).                                                                                                                                                                                                                                                       |
| `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`  | Required when `STORAGE_DRIVER=s3` (boot fails fast if any is missing).                                                                                                                                                                                                                                    |
| `MEDIA_KEY_PREFIX`                                                             | Optional. **Empty** (default) for a dedicated bucket → keys are surface-first: `<surface>/<org>/<owner>/<uuid>`. Set a value only when sharing a bucket.                                                                                                                                                  |
| `CORS_ORIGINS`                                                                 | Comma-separated frontend origins (or `*`).                                                                                                                                                                                                                                                                |
| `MEETING_WORKER_CONCURRENCY` / `CAPTURE_WORKER_CONCURRENCY`                    | Per-poll batch sizes (default `2` / `3`). Meetings hold ~90 MB in RAM each — keep theirs low and size the worker box for `MEETING_WORKER_CONCURRENCY × ~120 MB`.                                                                                                                                          |
| `PRESIGN_UPLOAD_EXPIRY_SECONDS`                                                | Presigned-upload URL lifetime (default `900`). Generous so a 10 MB capture survives a slow mobile link.                                                                                                                                                                                                   |
| `MEETING_AI_TIMEOUT_MS`                                                        | Per-attempt meeting-AI timeout (default `800000` ≈ 13 min). The pg-boss visibility window + the frontend poll patience both derive from this.                                                                                                                                                             |
| `JOB_RETRY_LIMIT`                                                              | pg-boss re-dispatches a job whose worker died up to this many times (default `2`).                                                                                                                                                                                                                        |
| `RUN_WORKER_IN_PROCESS`                                                        | Default `true`. Set `false` to run a dedicated worker (see below).                                                                                                                                                                                                                                        |

## Migrations

The image runs `prisma migrate deploy` on start (idempotent — applies only pending). The
catch-up migration `20260619120000_add_processing_job_and_meeting_media_keys` creates the
`ProcessingJob` table and `Meeting.mediaKeys`.

- **Single instance:** migrate-on-start (the default `CMD`) is fine.
- **>1 replica:** run `prisma migrate deploy` as a one-off **release task** and start the app
  containers with just `node dist/index.js`, so replicas don't race on migration.

## S3 bucket — CORS (enables direct browser→S3 upload)

Direct upload is a progressive enhancement: until CORS is set, clips upload through the backend
(byte fallback) and everything still works. To turn on direct-to-S3, set bucket CORS:

```json
[
  {
    "AllowedMethods": ["POST"],
    "AllowedOrigins": ["https://your-frontend-origin"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Optional lifecycle (per surface, since keys are `<surface>/…` in the dedicated bucket): e.g. keep
`meetings/` 90 days, `voice/` + `image/` 30 days; abort incomplete multipart uploads after 7 days.

## How production ACTUALLY runs (as of 2026-08-25)

> The Docker/Fargate options below are the documented _options_. What is deployed today is
> **neither**: an **EC2** box (`day-planner-prod`, `i-0a7665218d9211593`) running the built app
> under **PM2** as `day-planner-backend` on **port 8000**, behind **nginx**. Trust this section over
> the Docker instructions when debugging live.

```
browser ──HTTPS──▶ nginx (:443, Certbot TLS)  ──▶  PM2 `day-planner-backend` (127.0.0.1:8000)
                    │  /        → /var/www/day-planner  (static SPA)
                    │  /api/    → proxy_pass to the Node app
                    └─ config: /etc/nginx/conf.d/day-planner.conf
```

- **Restart after an `.env` change:** `pm2 restart day-planner-backend --update-env`.
  (`pm2 env 0` will NOT show app config — the app loads `.env` itself via dotenv in
  `src/config/env.ts` with `override: true`, so the FILE wins. Verify by curling the app.)
- **Database:** AWS RDS since 2026-08-24 — see [.agents/DATABASE-ACCESS.md](./.agents/DATABASE-ACCESS.md).

### ⚠️ nginx `client_max_body_size` — the upload trap

nginx's default body limit is **1 MB**, while the app accepts **10 MB** (`MAX_MEDIA_BYTES`).
Left at the default, nginx returns **413** for anything larger _before the request reaches Node_ —
so uploads fail with **nothing in `pm2 logs`**. The config therefore sets:

```nginx
server {                                # the :443 block, NOT the Certbot redirect block
    client_max_body_size 12M;           # ABOVE the app's 10M, deliberately

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_request_buffering off;    # stream large uploads instead of buffering to disk
        proxy_read_timeout 300s;        # headroom for slow mobile connections
    }
}
```

**Why 12M and not 10M:** nginx must never be the component that rejects. At 12M an oversized file
reaches the app, which returns a proper `413 FILE_TOO_LARGE` _with CORS headers_ and a readable
message (`src/middleware/upload.ts` maps multer's `LIMIT_FILE_SIZE`). Let the app own the limit.

Apply changes with `sudo nginx -t && sudo systemctl reload nginx` — `-t` validates before anything
changes, and `reload` swaps workers with no dropped connections.

### Debugging tip: a 4xx at the edge LOOKS like a CORS error

This cost real hours. Both **nginx's 413** and **S3's 403** (presigned-POST policy rejection) return
error responses **without `Access-Control-Allow-Origin`**. The browser cannot read them, so it
reports a **CORS failure** — sending you off to check CORS config that was correct all along.

Two rules that cut straight through it:

1. **Reproduce while tailing `pm2 logs day-planner-backend --lines 0`.** Every 4xx is logged with
   route + code (`src/middleware/error.ts`). **Silence means the request never reached the app** —
   so the failure is at nginx or S3, not in your code.
2. **Symptom differs by device? It is not CORS.** CORS is origin-based, not device-based. "Works on
   laptop, fails on phone" means the _payload_ differs — phone photos are 2–30 MB where laptop
   screenshots are under 1 MB. That is a size limit, not a CORS rule.

## Run

**EC2 (Docker):**

```
docker build -t kims-backend .
docker run -d --env-file .env -p 3000:3000 kims-backend
```

**ECS Fargate (no VM):** push the image; run one service from it. Optionally split:

- web service: `node dist/index.js` with `RUN_WORKER_IN_PROCESS=false`
- worker service: `node dist/worker.js` (`desiredCount: 1`, no load balancer)

Both point `DIRECT_DATABASE_URL` at the unpooled endpoint.

### Splitting the worker out (`RUN_WORKER_IN_PROCESS=false`) — gotchas

Recommended once meeting volume grows: it isolates the 90 MB-meeting memory pressure from the web
tier (a worker OOM can no longer take the website down). But mind these:

1. **You must run the worker.** With `false`, the web process only _enqueues_ — it never consumes.
   Forget `node dist/worker.js` and jobs sit `queued` forever with **no error**.
2. **Disable the worker container's healthcheck.** The image `HEALTHCHECK` hits `/livez` (HTTP);
   `worker.ts` has **no HTTP server**, so that healthcheck marks the worker unhealthy and
   restart-loops it. Run the worker with the healthcheck off (ECS: no container health check;
   `docker run --no-healthcheck`).
3. **Both processes need the same creds.** The web still runs the **synchronous** AI endpoints
   (`/transcribe`, `/text`, `/day-closure/review`) and presigns/uploads, and still calls
   `startQueue()` to enqueue — so **both** need `DIRECT_DATABASE_URL` (unpooled), Vertex, and S3.
4. **Migrations + reconciler.** The worker does **not** run `prisma migrate deploy` (only the web
   `CMD` does) — run migrations first (web container or a release task). The startup **stuck-job
   reconciler** runs in whichever process consumes the queue (the worker, when split); it's
   idempotent across replicas.
5. **Size the worker for RAM (≥4 GB)**, not the web. `MEETING_WORKER_CONCURRENCY` /
   `CAPTURE_WORKER_CONCURRENCY` are read by the worker — set them there. Scale throughput with the
   worker's `desiredCount` (each instance runs `MEETING_WORKER_CONCURRENCY` meetings at once).

## Security

- **Rotate the AWS key** if it was ever shared in plaintext.
- Scope the IAM user to `s3:{PutObject,GetObject,DeleteObject}` on `arn:aws:s3:::<bucket>/*`
  (the bucket is dedicated to this app's media).
