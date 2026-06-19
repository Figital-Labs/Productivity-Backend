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
| `WORKER_CONCURRENCY`                                                           | Default `3`.                                                                                                                                                                                                                                                                                              |
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

## Security

- **Rotate the AWS key** if it was ever shared in plaintext.
- Scope the IAM user to `s3:{PutObject,GetObject,DeleteObject}` on `arn:aws:s3:::<bucket>/*`
  (the bucket is dedicated to this app's media).
