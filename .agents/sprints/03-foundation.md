---
id: SPRINT-03
title: Foundation Infra
status: in-progress
sprint: 3
started: 2026-05-22
completed: null
owner: claude-session
tags: [sprint, foundation, infra]
related: [ADR-0007, ADR-0008, ADR-0016, ADR-0018]
---

# Sprint 03 — Foundation Infra

## Goal

Build the shared infrastructure every endpoint will use: env validation, error handling, stub auth middleware, the `createApp()` factory, signal handlers for graceful shutdown, and health endpoints. **No business logic in this sprint** — just the scaffold the next sprints will build on top of.

## Owner Pattern

Solo agent. User reviews at the checkpoint.

## Tasks

- [ ] **3.1** — Install `zod`.
- [ ] **3.2** — `src/config/env.ts` — single typed export, zod-validated. Includes parsed `GOOGLE_SERVICE_ACCOUNT_JSON` as a typed credentials object. Crash at boot if anything is missing or malformed.
- [ ] **3.3** — `src/lib/errors.ts` — `AppError` base class + subclasses (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`). Each subclass has a known `code` and `statusCode`.
- [ ] **3.4** — `src/middleware/auth.ts` — reads `X-User-Id` header; if missing, falls back to `env.demoUserId`; attaches `req.user = { id, orgId, role }`. Per [ADR-0008](../decisions/0008-stub-auth.md).
- [ ] **3.5** — `src/middleware/error.ts` — central Express error handler. `AppError` → `{ error: { code, message, details? } }` with the right status. Unknown errors → 500 generic, never leak stack traces to clients. `console.error` the full error.
- [ ] **3.6** — `src/routes/health.routes.ts` — `/livez` always 200 `{ status: "ok" }`. `/readyz` checks DB via `prisma.$queryRaw\`SELECT 1\``; returns 200 if up, 503 if down.
- [ ] **3.7** — `src/app.ts` — `createApp()` factory that composes middleware (json body, auth, routes, error handler last). Mounts health routes at root (unversioned). Future endpoints go under `/api/v1`.
- [ ] **3.8** — `src/index.ts` — boot `createApp()`, register SIGTERM/SIGINT handlers for graceful shutdown (stop accepting new connections, wait for in-flight, disconnect Prisma, exit), `uncaughtException` and `unhandledRejection` handlers that log + exit. Force-exit timeout 30s.

## Out of Scope This Sprint

- Logger / structured logging — deferred per [ADR-0018](../decisions/0018-deferred-logging.md). Use `console.*`.
- Request ID / AsyncLocalStorage — deferred with logging.
- Idempotency middleware — wired in when first mutating endpoint needs it (Sprint 4+).
- Multer / upload middleware — wired in when first file-upload endpoint needs it (Sprint 5).
- Vertex client setup — Sprint 5.
- Any business logic / domain entities — Sprint 4+.

## Acceptance Criteria

- `npm run dev` boots cleanly with no errors and no warnings.
- `curl localhost:3000/livez` → `200 {"status":"ok"}`.
- `curl localhost:3000/readyz` → `200 {"status":"ok","checks":{"db":"ok"}}` when Postgres is up.
- Stopping the Postgres container makes `/readyz` return `503` with the failing check named.
- `Ctrl+C` triggers the SIGINT handler — see the "graceful shutdown" log line; no zombie process.
- `npm run lint`, `npm run typecheck`, `npm run format:check` all pass clean.
- The Vertex hello-world script still runs (no regressions to existing code).

## Checkpoint Verification

User runs:
1. `npm run dev` — sees clean boot log.
2. `curl localhost:3000/livez` and `curl localhost:3000/readyz` — both return 200 JSON.
3. Optionally: stop the Postgres container (`docker stop task-list-postgres`), curl `/readyz` again, see 503; restart it, see 200.
4. `Ctrl+C` in the dev terminal — sees graceful shutdown message before the process exits.
5. `npm run lint` and `npm run typecheck` — both clean.
