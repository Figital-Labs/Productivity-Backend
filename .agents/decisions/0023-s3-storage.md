---
id: ADR-0023
title: S3 for media storage (deferred until credentials)
status: accepted
date: 2026-05-22
tags: [storage, infrastructure]
supersedes: ADR-0009
related: [ADR-0001]
---

# ADR-0023: S3 for Media Storage (Deferred Until Credentials)

## Context

[ADR-0009](./0009-gcs-storage.md) chose GCS for media uploads on the reasoning that we are already on GCP for Vertex AI and could reuse the service account. That decision has been reversed by the user (2026-05-22): media storage will be **S3**, not GCS. Bucket and credentials are not yet provisioned, so the storage work continues to be deferred.

## Decision

When task media + day-closure attachments + meeting media (later) need persistence, they go to **S3**. Code talks to a `BlobStorage` interface (carried over from ADR-0009); the only concrete implementation will be `S3Storage`.

```typescript
// src/lib/storage/index.ts (unchanged from ADR-0009)
export interface BlobStorage {
  upload(path: string, data: Buffer | NodeJS.ReadableStream, meta?: { contentType?: string }): Promise<string>;
  delete(path: string): Promise<void>;
  signedGetUrl(path: string, ttlSeconds: number): Promise<string>;
}

// src/lib/storage/s3.ts
export class S3Storage implements BlobStorage { ... }
```

`TaskMedia.url` stores the `s3://bucket/key` URI; the frontend calls a separate endpoint to mint a presigned GET URL for display.

## Reasoning

- **User decision.** No engineering reason to override — both clouds work technically.
- **Interface from ADR-0009 carries over unchanged.** The abstraction held — only the implementation file changes. Vindicates the BlobStorage decision.
- **Demo constraint from ADR-0009 still applies:** media must be served live from cloud, not from the developer's laptop.

## Alternatives Considered

- **GCS (original ADR-0009).** Reversed by user.
- **Cloudflare R2 (S3-compatible, no egress fees).** Still a reasonable revisit option once we know real egress volume.

## Consequences

- Until S3 credentials land, all storage work stays deferred (same posture as ADR-0009).
- Required env vars (when S3 is wired): bucket / region / access key / secret (or instance role / web identity in a deployed env). **As implemented** the names are the SDK-native `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `MEDIA_KEY_PREFIX`) — not the `S3_*` names sketched above. See `src/config/env.ts` (`env.s3`).
- Vertex AI service account no longer doubles as the storage credential — separate AWS IAM principal needed.
- `TaskMedia.url` now stores `s3://` URIs (was `gs://`). No existing rows to migrate; the column is empty.

## Revisit If

- Egress costs balloon → consider R2.
- Multi-cloud setup is undesirable; reconsider GCS later (would be ADR-0026 — `gs://`
  is natively readable by Vertex Gemini, saving the worker's S3 download).

## Update (2026-06-17): Implemented

S3 credentials landed; this ADR is **implemented**. The `BlobStorage` interface lives in
`src/lib/storage/index.ts` with the concrete `S3Storage` in `src/lib/storage/s3.ts`
(`upload` + `download` today; `signedGetUrl`/`signedPutUrl`/`delete` grow with later
phases). Meeting media is now persisted to S3 and processed asynchronously — see
**[ADR-0025](./0025-async-media-processing.md)** and `.agents/media-pipeline.md`.
