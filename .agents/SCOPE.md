# SCOPE — What's In, What's Out, and Why

> Read [PROJECT.md](./PROJECT.md) first for product context. This file is the *boundary* document — what we commit to building for POC, what we explicitly defer, and the reasoning for each call.

## Scope Philosophy

This is a **POC** (proof of concept). The audience is a client deciding whether to fund the real product. So:

- **In scope** = features the client must see working in the demo.
- **Out of scope (deferred)** = anything that doesn't directly serve the demo, even if we'll definitely need it for production. *Including* things like proper observability, real auth, automated tests, and compliance hardening.
- **The schema and code structure** are designed for the *production* shape (multi-tenant, hospital hierarchy, manager review). But the *runtime behavior* is single-user POC.

The goal: minimum surface area to demonstrate the product idea, with no accidental commitments to bad architecture that we'd have to undo later.

---

## In Scope

### Core entities (full CRUD)
- **Task** — create, read, update (mark complete, mark partial, edit title/notes/priority), soft delete, restore.
- **Note** — standalone sticky notes, separate from Task. Create, read, update, archive, soft delete.
- **Holiday** — per-user calendar of non-working days. List, toggle.
- **Alert** — in-app notification inbox. Manual create + AI-generated. List, dismiss.

### AI-driven flows
- **`POST /voice/process`** — general-purpose voice action. Takes audio (and optionally images + text bundled by the frontend). Uses current pending tasks as context. Gemini classifies intent per phrase: `created` / `priority_updated` / `completed` / `partial`. Things the AI is unsure about go to a `recommendations` array (not auto-created).
- **`POST /images/process`** — Gemini Vision OCR on handwritten task sheets. Same response shape as `/voice/process` minus the transcript.
- **`POST /day-closure/submit`** — submit end-of-day retrospective. Internally reuses the voice intent classification, *plus* makes a second Gemini call to generate structured `aiFeedback` (achievements, missed, partial, additions, tips, summary).
- **`POST /alerts/generate`** — Gemini analyzes the user's current task list and emits smart alerts.

### Day-plan and day-closure flows
- **`POST /day-plan/submit`** — snapshot today's tasks at the moment of submission. Stored as immutable JSON. User can keep editing the live task list afterward, but the snapshot stays — that's what a future manager would review.
- **`POST /day-closure/submit`** — see above.

### Media attachments
- Photos / videos / audio attached to tasks as proof-of-work. Stored in **GCS** (Google Cloud Storage), referenced by URL in the DB.

### Cross-cutting
- **Per-user timezone**. Default `Asia/Kolkata`. All "today" queries respect the user's local date.
- **Soft delete + restore** on Task and Note (the UI has restore, backend supports it).
- **Idempotency-Key** header on mutating POSTs (in-memory map for POC; swap to Redis later).
- **Health endpoints**: `/livez` (always 200), `/readyz` (200 only if DB pool is healthy).
- **API versioning**: every route under `/api/v1/...`.

### Schema-level discipline (built now, dormant until later)
- **`userId` foreign key** on every owned entity from day 1.
- **`orgId` + `role`** columns on `User` from day 1.
- **`canAccess(user, resource)` helper** wrapped around every read/write. For POC it returns `true`. When hierarchy arrives, that one function gets the logic; query sites don't change.

---

## Out of Scope (Deferred)

Each item below has a reason and the conditions under which we'd add it.

### Auth & Identity
- **Real login / signup** — *Deferred.* POC uses a stub middleware that reads `X-User-Id` header and returns a hardcoded user. **When to add:** when the client demo needs a login screen, OR when multi-user testing begins. Likely choice when added: **Google OAuth** (aligns with our GCP stack, no password/email-provider dependency).
- **Multi-tenant / org isolation** — *Deferred.* All rows have the same hardcoded `orgId` for POC. **When to add:** when more than one user/org actually exists. Schema is ready; only the `canAccess` helper needs real logic.
- **Hospital hierarchy (manager ↔ staff)** — *Deferred.* The User schema has a `role` column from day 1. **When to add:** post-POC, with the client's actual org-chart requirements.

### Compliance
- **PHI / HIPAA hardening** — *Deferred.* POC uses dummy data; no real patient information. **When to add:** before any real hospital data touches the system. Requires: encryption-at-rest (already true for managed Postgres), no PHI in logs, audit log on every read, BAA with Google for Vertex usage, formal access review.

### Product features
- **Meetings** — *Deferred entirely from backend.* The frontend has a Meetings tab; the backend won't build it for POC. Frontend will need to either hide the tab or accept that meeting features don't persist. **When to add:** if the client signals it's a key feature in the demo response. Adds: streaming STT for long meetings (Vertex `streamingRecognize` over WebSocket), async job processing.
- **Live captions during meetings / real-time STT** — *Deferred.* Even when meetings come back, the first version uses post-meeting batch transcription, not live captions.
- **Analytics / streaks / dashboards** — *Deferred.* History view shows a log, not graphs. **When to add:** when the client asks for it.
- **Email, push notifications, SMS** — *Deferred.* Alerts are in-app only for POC. **When to add:** when the client wants reminders that work when the app is closed.

### Infrastructure
- **Redis** — *Deferred.* One user; nothing to cache; no queue to back. **When to add:** when we need distributed rate limiting, idempotency keys across pods, session storage, or BullMQ.
- **BullMQ / async job queue** — *Deferred.* All flows are sync HTTP. The longest call (Vertex multimodal with audio) is under 30s. **When to add:** when meetings come back (long audio), or when batch processing is needed.
- **Caching layer** — *Deferred.* One user; latency is not a concern. **When to add:** when read-heavy endpoints show measured latency problems.
- **Rate limiting** — *Deferred.* Single user can't rate-limit themselves. **When to add:** as soon as multi-user enters the picture.

### Observability
- **Structured logging (pino)** — *Deferred.* Plain `console.log` / `console.error` for POC. **When to add:** when deploying to staging or production, OR when debugging stops being trivial. Comes with: request IDs via AsyncLocalStorage, pino-http for request logging, log levels configured via env.
- **Tracing (OpenTelemetry)** — *Deferred.* **When to add:** when there are multiple services to trace across.
- **Metrics (Prometheus / Grafana)** — *Deferred.* **When to add:** in production.
- **APM (Datadog, Sentry)** — *Deferred.* **When to add:** in production.

### Engineering hygiene (NOT skipped, just self-enforced)
- **Automated tests (vitest, supertest, integration tests)** — *Deferred.* POC relies on manual `curl` checks at each sprint's checkpoint. **When to add:** when the surface stabilizes (post-POC). **Important caveat:** deferring tests does NOT relax the code-quality bar. We use `/simplify` at sprint checkpoints to enforce quality.
- **OpenAPI / Swagger spec** — *Deferred.* Frontend team reads the route files directly. **When to add:** when client integration via auto-generated SDKs is on the table.

### Cloud / deployment
- **Vertex AI in production mode** — *In scope but minimal.* We use the provided service account from day 1 (so the integration is real), but we don't worry about multi-region, vector caching, fine-tuning, or any advanced Vertex feature.
- **S3 / Cloudflare R2 storage backend** — *Deferred.* GCS-only for POC; the `BlobStorage` interface lets us add S3 later without touching business logic.
- **CI/CD pipeline** — *Deferred.* Local dev only for POC. **When to add:** when we deploy anywhere.
- **Dockerfile for the app** — *Deferred.* User handles their own local Postgres-via-Docker setup. **When to add:** when we deploy anywhere or onboard a second contributor.
- **Production deployment** — *Deferred.* POC runs on the developer's laptop.

---

## "Why Not Just Add It All?" — The Counter-Argument

Common temptation: "the schema/code is so small, why not add real auth / logging / tests / Docker now?"

The answer: **every line of code is a future maintenance liability.** A POC's purpose is to *prove the product idea*, not to be production-ready. Adding tests now means writing them against an API surface that will change. Adding auth now means a login screen the client doesn't need to see. Adding logging now means setting up log aggregation we won't ship.

The discipline: do the *cheap, hard-to-undo* things now (schema design, layered architecture, `userId` everywhere). Defer the *expensive, easy-to-add* things until they're needed (tests, auth, observability).

If you're tempted to "just add it while you're there," check this file first.
