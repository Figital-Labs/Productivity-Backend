---
id: SCOPE
title: What's In and Out of POC
status: stable
date: 2026-05-22
tags: [scope, planning]
related: [PRODUCT]
---

# Scope

> ⚠️ **SUPERSEDED (2026-06-11).** Most items this doc lists as "deferred / out of POC"
> (meetings, hierarchy/matrix, dashboards, analytics, multi-tenant orgs) are now BUILT. For
> current product reality read PRODUCT.md; for what's parked/dormant see GOTCHAS.md. Kept
> below for historical scope rationale only.

## Scope Philosophy

This is a **POC** (proof of concept). The audience is a client deciding whether to fund the real product.

- **In scope** = features the client must see working in the demo.
- **Deferred** = anything that doesn't directly serve the demo, even if we'll definitely need it for production.
- **The schema and code structure** are designed for the *production* shape (multi-tenant, hospital hierarchy, manager review). But the *runtime behavior* is single-user POC.

Goal: minimum surface area to demonstrate the product idea, with no accidental commitments to bad architecture that we'd have to undo later.

---

## In Scope

### Core entities (full CRUD)
- **Task** — create, read, update, soft delete, restore.
- **Note** — standalone sticky notes (per [GLOSSARY](./GLOSSARY.md)).
- **Holiday** — per-user calendar of non-working days.
- **Alert** — in-app notification inbox. Manual create + AI-generated.

### AI-driven flows
- `POST /voice/process` — general-purpose voice action (create / priority_update / complete / partial + recommendations). See [ADR-0003](./decisions/0003-voice-intent-classification.md).
- `POST /images/process` — Gemini Vision OCR on handwritten task sheets.
- `POST /day-closure/submit` — retrospective + structured AI feedback.
- `POST /alerts/generate` — Gemini analyzes current tasks → emits smart alerts.

### Day-plan and day-closure
- `POST /day-plan/submit` — snapshot at submission. See [ADR-0011](./decisions/0011-submit-snapshot.md).
- `POST /day-closure/submit` — see above.

### Media
- Photos / videos / audio attached to tasks as proof-of-work, stored in **S3** (deferred until credentials). See [ADR-0023](./decisions/0023-s3-storage.md) (supersedes ADR-0009).

### Cross-cutting
- Per-user timezone, default `Asia/Kolkata`. See [ADR-0010](./decisions/0010-per-user-timezone.md).
- Soft delete + restore. See [ADR-0013](./decisions/0013-soft-delete.md).
- Idempotency-Key on mutating POSTs. See [ADR-0017](./decisions/0017-idempotency-keys.md).
- `/livez` + `/readyz` health endpoints.
- API versioning under `/api/v1/...`. See [ADR-0015](./decisions/0015-api-versioning.md).

### Schema discipline (built now, dormant until later)
- `userId` foreign key on every owned entity.
- `orgId` + `role` columns on `User` from day 1.
- `canAccess(user, resource)` helper wrapped around every read/write.

---

## Deferred

Each item has a reason and the conditions under which we'd add it.

### Auth & Identity

| Item | Status | When to revisit |
|---|---|---|
| Real login / signup | Basic email/password + JWT is now built. See [ADR-0022](./decisions/0022-basic-jwt-auth.md). | Revisit for OAuth/SSO, password reset, token revocation, or production hardening. |
| Multi-tenant / org isolation | Deferred — schema is ready. | More than one user/org exists. |
| Hospital hierarchy (manager ↔ staff) | Deferred — `User.role` column exists. | Post-POC, with client's org-chart requirements. |

### Compliance

| Item | Status | When to revisit |
|---|---|---|
| PHI / HIPAA hardening | Deferred — POC uses dummy data. | Before any real patient information touches the system. Requires encryption-at-rest, audit logs, BAA with Google for Vertex, formal access review. |

### Product Features

| Item | Status | When to revisit |
|---|---|---|
| Meetings (including recording, summarization, action items) | Deferred entirely from backend. | If the client signals it's a key feature in the demo response. Adds: streaming STT, async job processing. |
| Live captions / real-time STT | Deferred. | When meetings come back AND live captions are a stated requirement. |
| Analytics / streaks / dashboards | Deferred — History is a log, not graphs. | When client asks for it. |
| Email / push / SMS notifications | Deferred — alerts are in-app only. | When client wants reminders that work when the app is closed. |

### Infrastructure

| Item | Status | When to revisit |
|---|---|---|
| Redis | Deferred. | Distributed rate limiting, cross-pod idempotency keys, session storage, or BullMQ. |
| BullMQ / async job queue | Deferred — all flows are sync HTTP. | Meetings come back (long audio), OR batch processing is needed. |
| Caching layer | Deferred. | Read-heavy endpoints show measured latency problems. |
| Rate limiting | Deferred — single user. | Multi-user enters the picture. |

### Observability

| Item | Status | When to revisit |
|---|---|---|
| Structured logging (pino) | Deferred — `console.*` for POC. See [ADR-0018](./decisions/0018-deferred-logging.md). | Deploying to staging/production, OR debugging stops being trivial. |
| Tracing (OpenTelemetry) | Deferred. | Multiple services to trace across. |
| Metrics (Prometheus / Grafana) | Deferred. | Production. |
| APM (Datadog, Sentry) | Deferred. | Production. |
| Request IDs / AsyncLocalStorage | Deferred — went with logging. | When logging is added. |

### Engineering Hygiene

| Item | Status | When to revisit |
|---|---|---|
| Automated tests (vitest, supertest, integration) | Deferred — manual curl at sprint checkpoints. See [ADR-0019](./decisions/0019-deferred-tests.md). **Caveat:** deferring tests does NOT relax the code-quality bar. We use `/simplify` at sprint checkpoints. | Surface stabilizes, post-POC. |
| OpenAPI / Swagger spec | Deferred — frontend reads route files. See [ADR-0020](./decisions/0020-deferred-openapi.md). | Client integration via auto-generated SDKs is on the table. |

### Cloud / Deployment

| Item | Status | When to revisit |
|---|---|---|
| Cloudflare R2 storage backend | Deferred — S3 chosen but not wired. R2 is S3-compatible so the same impl can target it. | Cheaper provider needed at scale. |
| CI/CD pipeline | Deferred — local dev only. | Any deployment. |
| Dockerfile for the app | Deferred — user handles their own Postgres-via-Docker. | Any deployment OR onboarding a second contributor. |
| Production deployment | Deferred. | Post-POC pilot. |

---

## "Why Not Just Add It All?" — The Counter-Argument

Common temptation: *"the schema/code is so small, why not add OAuth / logging / tests / Docker now?"*

The answer: **every line of code is a future maintenance liability.** A POC's purpose is to *prove the product idea*, not to be production-ready. Tests written now would mostly be deleted as the API surface changes. OAuth and password-reset flows mean external-provider setup the client doesn't need for this stage. Logging now means setting up log aggregation we won't ship.

The discipline: do the *cheap, hard-to-undo* things now (schema design, layered architecture, `userId` everywhere). Defer the *expensive, easy-to-add* things until they're needed (tests, auth, observability).

**If you're tempted to "just add it while you're there," check this file first.**
