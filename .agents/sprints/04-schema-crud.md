---
id: SPRINT-04
title: Sprint 4 — Schema + Pure CRUD (no AI yet)
status: in_progress
owner: claude-session
started: 2026-05-22
completed: null
tags: [sprint, schema, crud]
related: [ARCHITECTURE, ADR-0007, ADR-0010]
---

# Sprint 4 — Schema + Pure CRUD (no AI yet)

## Goal

Get a working conventional to-do API running **before any AI sugar**. After this sprint, a frontend (or curl) can create / list / update / soft-delete / restore Tasks, Notes, and Holidays for the demo user.

This sprint deliberately avoids voice, image, day-plan, day-closure, alerts, media, and uploads. Those land in Sprints 5–8. **The schema, however, includes every model** so later sprints don't need a second migration just to add columns.

## Non-goals (deferred)

- Voice / image endpoints → Sprint 5
- Media attachments → Sprint 6 (needs GCS)
- Day plan / closure endpoints → Sprint 7
- Alerts endpoints → Sprint 8
- History search → Sprint 8
- Idempotency middleware → first AI sprint (Sprint 5) or later
- Structured logging → deferred ([ADR-0018](../decisions/0018-deferred-logging.md))
- Tests → deferred ([ADR-0019](../decisions/0019-deferred-tests.md))

## Tasks

### 4.1 — Prisma schema + first migration
- Add all 10 models to `prisma/schema.prisma` per [ARCHITECTURE.md](../ARCHITECTURE.md): `User`, `Task`, `TaskMedia`, `Note`, `Alert`, `Holiday`, `DayPlanSubmission`, `DayClosureSubmission`, `VoiceInteraction`, `ImageExtraction`.
- Run `npm run db:migrate` with name `init` (creates `prisma/migrations/<ts>_init/`).
- Verify `prisma generate` regenerates the client at `src/generated/prisma`.

### 4.2 — Seed script
- `prisma/seed.ts` — upserts one User (`demo-user-1`, email `demo@kims.local`, name "Demo User", role "staff", orgId "demo-org", tz "Asia/Kolkata").
- Add `prisma.seed` field in `package.json` → `"tsx prisma/seed.ts"`.
- Run `npx prisma db seed` to verify.

### 4.3 — Zod schemas
Under `src/schemas/`:
- `common.ts` — shared `idParam`, `dateString` (YYYY-MM-DD), pagination cursor.
- `task.schema.ts` — `createTaskInput`, `updateTaskInput`, `listTasksQuery`.
- `note.schema.ts` — `createNoteInput`, `updateNoteInput`.
- `holiday.schema.ts` — `toggleHolidayInput`, `listHolidaysQuery`.

Types inferred from schemas (`z.infer<typeof X>`). No hand-written input types.

### 4.4 — Utils
- `src/utils/auth.ts` — `canAccess(user, resource)` returns `true` for POC; central seam for the future multi-tenant check.
- `src/utils/date.ts` — `todayInUserTz(timezone)` returns a `Date` at start-of-day in the user's TZ. Uses `Intl.DateTimeFormat` (no extra dep).

### 4.5 — Repository layer
Under `src/repositories/`. **Only place Prisma is called** ([ADR-0007](../decisions/0007-layered-architecture.md)).
- `task.repository.ts` — `findById`, `listByDate`, `listPending` (for future AI context), `create`, `update`, `softDelete`, `restore`.
- `note.repository.ts` — `findById`, `list`, `create`, `update`, `archive`, `softDelete`.
- `holiday.repository.ts` — `findByDate`, `listInRange`, `upsert`, `delete`.

Repositories take plain inputs (no Express types), return Prisma model types (or `null` when not found — services convert to `NotFoundError`).

### 4.6 — Service layer
Under `src/services/`. Framework-agnostic, no Express imports.
- `task.service.ts` — wraps repo, throws `NotFoundError("Task")` on missing, applies `canAccess`. Restore only un-soft-deletes if currently soft-deleted (else `ConflictError`).
- `note.service.ts` — same shape. Archive sets `archived=true` (separate from soft-delete which sets `deletedAt`).
- `holiday.service.ts` — toggle returns `{added: boolean}` so the controller can pick 201 vs 200.

### 4.7 — Controllers + routes
- Controllers under `src/controllers/` — parse req with zod schema, call service, return JSON. No business logic.
- Routes under `src/routes/`:
  - `tasks.routes.ts` (GET / POST / PATCH / DELETE / POST /:id/restore)
  - `notes.routes.ts` (GET / POST / PATCH / POST /:id/archive / DELETE)
  - `holidays.routes.ts` (GET / POST /toggle)
- New `src/routes/v1.ts` — assembles the `/api/v1` router and mounts the three above.
- Update `src/app.ts` to mount `app.use("/api/v1", v1Router)`.

### 4.8 — Checkpoint smoke test
Manual curl matrix. With dev server running and demo user seeded:

```
POST   /api/v1/tasks                       — create
GET    /api/v1/tasks?date=today            — list
PATCH  /api/v1/tasks/:id                   — toggle complete
DELETE /api/v1/tasks/:id                   — soft delete
POST   /api/v1/tasks/:id/restore           — restore
POST   /api/v1/notes                       — create
GET    /api/v1/notes                       — list
POST   /api/v1/holidays/toggle             — add holiday
POST   /api/v1/holidays/toggle             — remove same holiday (idempotent)
```

All requests use `-H "X-User-Id: demo-user-1"`.

### 4.9 — `/simplify` pass
Run `/simplify` on the new files. Fix anything flagged. This is the quality gate in place of CI ([ADR-0019](../decisions/0019-deferred-tests.md)).

## Sync points (where I pause for you)

1. **Before running first migration** — confirm `DATABASE_URL` is the local dev one, not the Neon prod URL. (Migration runs against whichever URL is loaded.)
2. **After 4.6 (services done)** — quick read of the layered code before I wire controllers + routes, so the shape of the layering is approved once and applies to Notes/Holidays automatically.
3. **At 4.8 (smoke test)** — I run the curl matrix and report; you decide if we move on or fix something.

## Acceptance Criteria

- `npm run db:migrate` succeeds against local Postgres.
- `npx prisma db seed` creates `demo-user-1` (idempotent — second run doesn't error).
- All 11 endpoint behaviors above return correct status codes and shapes.
- `npm run typecheck` clean, `npm run lint` clean.
- No Prisma import outside `src/repositories/` or `src/lib/prisma.ts`.
- No Express type leakage into services.
- Sprint 5's voice-context query (`listPending`) is exposed by the task repository so Sprint 5 can plug straight in.

## Deferred until later in this sprint or next

- Pagination on list endpoints — POC has one user; defer until the list grows.
- `Idempotency-Key` middleware — first AI sprint.
- OpenAPI generation — [ADR-0020](../decisions/0020-deferred-openapi.md).
