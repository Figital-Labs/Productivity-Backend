---
id: GLOSSARY
title: Project Glossary
status: stable
date: 2026-05-22
tags: [meta, terminology]
---

# Glossary

Stable terms used throughout this project. **If you're about to invent a new name for something that already has a name here, stop and use the existing term.**

If you encounter a term in code or docs that isn't in this glossary, either it's a standard term (in which case use the standard meaning) or it should be added here.

---

## Product Terms

**Day Plan** — The set of tasks a user commits to for a given day. Created in the morning (or before the day starts). Submitted via `POST /day-plan/submit`, which creates an immutable snapshot.

**Day Closure** — The end-of-day retrospective. User dictates / types what got done. AI maps mentions back to tasks (complete / partial / not-done) and generates structured feedback. Submitted via `POST /day-closure/submit`.

**Day Plan Submission** — The persisted artifact created by submitting a Day Plan. Contains an immutable JSON snapshot of the task list at the moment of submission. Used as the "what was promised" record for future manager review.

**Day Closure Submission** — The persisted artifact created by submitting a Day Closure. Contains the user's commentary, media references, and the AI's structured feedback.

**Ad-hoc Work** — Tasks the user *did* but never planned. Surfaces during day closure when the user mentions doing something not in today's task list. Per [ADR-0005](./decisions/0005-recommendation-pattern.md), this goes into a `recommendations` array, not auto-created.

**Recommendation Pattern** — Our convention: when the AI is unsure or the user implied a state change without explicitly requesting one, the AI returns a *suggestion* (not an action). Frontend renders Add/Skip buttons. Backend writes nothing until confirmed. See [ADR-0005](./decisions/0005-recommendation-pattern.md).

**Intent Classification** — The AI's job in `/voice/process` and `/day-closure/submit`: for each phrase the user uttered, decide which action it represents (`created`, `priority_updated`, `completed`, `partial`) and on which task. See [ADR-0003](./decisions/0003-voice-intent-classification.md).

**Voice Interaction** — A single round-trip through the voice endpoint. Persisted as a `VoiceInteraction` row containing the audio reference, transcript, structured actions, and recommendations.

**Image Extraction** — A single round-trip through the image endpoint (handwritten task sheet OCR). Persisted as an `ImageExtraction` row.

**Target Date** — The date a Task is *for* (`Task.targetDate`). Distinct from `createdAt` (when the task was made). A task created at 10pm tonight might have a target date of tomorrow.

**Holiday** — A day the user is not working. Per-user calendar. Affects which days "today's tasks" considers as the user's working day.

**Proof-of-Work** — Media (photo, video, audio) attached to a task as evidence that it was done. Stored in GCS, referenced by URL. See [ADR-0009](./decisions/0009-gcs-storage.md).

---

## Architectural Terms

**ADR** — Architectural Decision Record. One file per decision in `decisions/`. Stable IDs (`ADR-0001` through `ADR-NNNN`). Append-only — accepted ADRs are never edited; they're superseded by new ADRs.

**BlobStorage** — Our abstraction over file storage. Interface (`src/lib/storage/index.ts`); GCS implementation (`src/lib/storage/gcs.ts`); S3 implementation deferred. See [ADR-0009](./decisions/0009-gcs-storage.md).

**Repository Layer** — The only layer that calls Prisma. Services call repositories; controllers call services. See [ADR-0007](./decisions/0007-layered-architecture.md).

**Service Layer** — Business logic. Framework-agnostic (no Express types). Composed of repositories.

**Controller** — Orchestrates services in response to an HTTP request. Knows about req/res but not about Prisma.

**Stub Auth** — The middleware that reads `X-User-Id` from the request header and returns a hardcoded user. Used in place of real auth for POC. See [ADR-0008](./decisions/0008-stub-auth.md).

**`canAccess(user, resource)`** — The authorization helper. Returns `true` for POC. When multi-tenant arrives, the only place authorization logic needs to live. See [ADR-0007](./decisions/0007-layered-architecture.md).

**Soft Delete** — Marking a row as deleted via `deletedAt` timestamp instead of removing it from the DB. Default queries filter `deletedAt IS NULL`. See [ADR-0013](./decisions/0013-soft-delete.md).

**Submission Snapshot** — Immutable JSON copy of the task list stored at submission time. The task list keeps mutating; the snapshot doesn't. See [ADR-0011](./decisions/0011-submit-snapshot.md).

**Idempotency Key** — Header on mutating POSTs. Backend stores `(key, response)` and returns the cached response on replay. See [ADR-0017](./decisions/0017-idempotency-keys.md).

**Sprint** — A single reviewable unit of work. Ends with a checkpoint where the user approves. One file per sprint in `sprints/`.

**Checkpoint** — The user-facing review at the end of a sprint. Sprint isn't complete until the user has approved at the checkpoint.

---

## External Services

**Vertex AI** — Google Cloud's managed Gemini service. Authenticated via GCP service account JSON. Our AI provider. See [ADR-0001](./decisions/0001-vertex-ai.md).

**Gemini 2.5 Flash** — The specific Vertex AI model we call. Multimodal — accepts audio, images, and text in one call.

**GCS** — Google Cloud Storage. Our blob storage provider. See [ADR-0009](./decisions/0009-gcs-storage.md).

**Prisma** — Our ORM. Postgres-backed.

---

## Roles (Future, Not Implemented)

These appear in the schema (`User.role`) with stub default values, in anticipation of multi-tenant hierarchy.

**Staff** — Default role. Creates their own tasks, runs their own day plan/closure.

**Manager** — *(Future.)* Reviews staff's day plans and closures. Can assign tasks to staff. Schema is ready; behavior not built.

**Admin** — *(Future.)* Org-level administration.

---

## Things That Are NOT Project Terms (Avoid These)

These look like they might be project terms but they're not — they're things I (the AI) might have hallucinated or that we explicitly decided against. **Do not introduce these.**

- ❌ `possibleDuplicateOf` — was a proposed Task field, explicitly rejected as YAGNI. No metadata field for duplicate hinting.
- ❌ `purpose` query param on voice endpoint — deprecated when we made voice general-purpose. The endpoint doesn't need a hint about morning vs midday.
- ❌ "Voice Transcript" entity — renamed to `VoiceInteraction` when the endpoint became general-purpose.
- ❌ "Public Gemini API" / `@google/generative-ai` SDK — we use Vertex, not the public API. See [ADR-0001](./decisions/0001-vertex-ai.md).
