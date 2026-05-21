---
id: ADR-0009
title: GCS from day 1, behind BlobStorage interface (S3 deferred)
status: accepted
date: 2026-05-22
tags: [storage, infrastructure]
supersedes: null
related: [ADR-0001]
---

# ADR-0009: GCS from Day 1, Behind a BlobStorage Interface

## Context

Users attach photos / videos / audio to tasks as proof-of-work. The original POC plan was to use local disk for storage and swap to GCS later. The user pushed back: even for the client demo, media must be served **live from cloud**, not from our laptop. Local-disk storage doesn't survive `git clone` on another machine, which is unacceptable for the demo.

## Decision

All media uploads to **GCS** from day 1. Code only talks to a `BlobStorage` interface; GCS is the only concrete implementation for POC. S3 / R2 implementations deferred.

```typescript
// src/lib/storage/index.ts
export interface BlobStorage {
  upload(path: string, data: Buffer | NodeJS.ReadableStream, meta?: { contentType?: string }): Promise<string>;
  delete(path: string): Promise<void>;
  signedGetUrl(path: string, ttlSeconds: number): Promise<string>;
}

// src/lib/storage/gcs.ts
export class GcsStorage implements BlobStorage { ... }
```

## Reasoning

- **Client demos must show media live from cloud**, not from the developer's laptop. This is the load-bearing constraint.
- **Aligned with Vertex** ([ADR-0001](./0001-vertex-ai.md)). Same GCP project, same service-account auth — just add `roles/storage.objectAdmin` on the bucket to the existing SA.
- **Interface keeps S3 / R2 / future providers swappable** without touching business logic. The interface is the abstraction; the GCS class is one implementation.

## Alternatives Considered

- **Local disk for POC, GCS later** — initially proposed, but failed the demo constraint. Reversed by user.
- **Base64 in DB** — bloats DB size, ruins WAL, awful for video. Never the right call.
- **S3 from day 1** — would require AWS account setup. We're on GCP for Vertex; staying single-cloud is simpler.

## Consequences

- User provides bucket name + adds `roles/storage.objectAdmin` to the SA when ready.
- Required env vars (when GCS is wired): `GCS_BUCKET_NAME`. The SA already has cred for it.
- **Sprint 5 (voice + AI) does not need GCS** — audio passes inline to Gemini, no persistence needed.
- **Sprint 6 (image processing + media attachments) is where storage is first exercised.** This is the earliest sprint that blocks on credentials landing.
- `TaskMedia.url` stores the `gs://bucket/path` URI; the frontend calls a separate endpoint to get a signed URL for display.

## Revisit If

- Need a cheaper provider at scale (R2 has no egress fees and is much cheaper than GCS).
- Need a second cloud (AWS) for any other reason.
