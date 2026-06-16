---
id: ARCHITECTURE
title: Data Model, API Surface, AI Layer
status: stable
date: 2026-06-11
tags: [architecture, schema, api, ai]
related: [PRODUCT, GOTCHAS, DEVELOPMENT]
---

# Architecture

> Refreshed 2026-06-11 from the code. The pre-2026-06 version described a single-user
> to-do POC; the system is now a multi-tenant hospital team-ops platform. **Trust the
> code** (`prisma/schema.prisma`, `src/routes/`) over any doc.

## Layers (dependencies point inward only)
`routes/` (HTTP framing) → `controllers/` (orchestrate) → `services/` (business logic) →
`repositories/` (the ONLY place Prisma is called). A service must not import an Express
type; a repository must not call Vertex. AI prompts live in `src/lib/prompts/`; the Vertex
client + resilience in `src/lib/vertex.ts`. See ADR-0007.

## Data model (`prisma/schema.prisma`) — current
Multi-tenant. Every owned row carries `orgId` or a `userId`.

- **Organization** — the tenant. `Users`/`Departments`/`ContextGroups` all FK to it. Super-admins (`User.isSuperAdmin`) create orgs.
- **User** — `email`, `name`, `passwordHash`, `role` ("staff"|"manager"|"admin"), **`level: Int`** (default 100; numeric seniority used by auth gates — *internal bookkeeping, not user-facing*), `orgId`, `isSuperAdmin`, `canManageUsers`, `timezone`. **Matrix hierarchy:** M2M self-relation `managers` ↔ `reports` — a person can have MULTIPLE managers (e.g. a lead under two directors).
- **Task** — **`assigneeId`** (who does it) vs **`creatorId`** (who created/delegated it) — equal for self-created, different for delegated. **`targetDate` (@db.Date) = the day the task lands on the assignee's list / when to do it — NOT a deadline** (deadlines go in `notes`; see GOTCHAS). `priority?`, `completed`, `isPartial`, `notes?`, `aiFeedback?`, `sourceType` (manual|voice|text|image|unified|meeting), `sourceId?`, `groupId?`, soft-delete (`deletedAt`), `media[]`.
- **Note**, **Alert** (model exists but **dormant — no routes wired**; frontend shows "Coming soon"), **Holiday** (PK `(userId,date)`).
- **DayPlanSubmission** — `taskSnapshot` Json, unique `(userId,date)`. Submission cutoff exists (12pm IST, per git history).
- **DayClosureSubmission** — two-phase: `status` "draft" (on `/review`, AI feedback generated once) → "submitted" (on `/submit`). `commentary`, `aiFeedback` Json (`achievements/missed/partial/additions/summary` + `taskActions`; the `tips` field was REMOVED), `mediaIds`.
- **VoiceInteraction / ImageExtraction / TextInteraction / UnifiedInteraction** — audit rows for each AI call (`actions`, `recommendations`, transcript/extractedText/inputText). UnifiedInteraction is for the **parked** unified path.
- **Meeting** — `userId` (creator), `attendeeIds: String[]` (loose, no FK), `type` ("hurdle"|"1-on-1"), `agenda?`, `notes?`, `summary?`, `customPrompt?`, `actions` Json, `recommendations` Json, `processedAt?` (lock — processed once). Audio is never persisted; streamed to Vertex inline.
- **Department** (`orgId`, `headId?`), **ContextGroup** (`kind`: ward|ot|shift|project|personal), **GroupMembership** (`isLead`, `canManage`, **time-bounded** `validFrom`/`validTo` — models shift coverage), **SubmissionReview** (per submission+manager — matrix review), **ReminderIntent** ("Send Reminder" stub, no delivery), **MorningBriefCache** (per manager+date).

## Authorization & visibility
- **`middleware/auth.ts`** — `jwtAuth` resolves `AuthenticatedUser` = `{ id, orgId, role, reportIds:Set, isSuperAdmin, canManageUsers, level }` in one query.
- **`lib/resolve-scope.ts`** — dashboard visibility authority. Priority: `admin` → whole org; department head → their depts; group lead → their groups; `manager` with reports → reports-only; else `none`.
- **`utils/auth.ts`** — `canManageUser` / delegation gate: target's `level` must be **below** the actor's AND target must be in the actor's **report subtree** (`reportSubtreeIds`). So a manager can delegate to anyone in their subtree (direct OR indirect), not just direct reports.

## AI layer
- **`lib/vertex.ts`** — single `GoogleGenAI` (Vertex) client; model `gemini-2.5-flash`. `generateStructured` (zod schema → `responseJsonSchema`, re-parsed on receipt) and `generateText`. Both support: `temperature`, `systemInstruction`, `thinkingBudget`, `maxRetries` (default 1), `timeoutMs` (default 30s), `onRaw` (raw-text hook). Wrapped in **retry-with-backoff** on recoverable failures (`AI_INVALID_JSON`/`AI_SCHEMA_MISMATCH`/`AI_EMPTY_RESPONSE`/`AI_TIMEOUT`/network) + per-attempt timeout. Backward-compatible (knobs conditionally spread).
- **`lib/ai-config.ts`** — per-surface `AI_TEMPERATURE` (extraction/delegation/meeting 0.2, dayClosure 0.3, morningBrief 0.35, transcribe 0.0), `AI_THINKING_BUDGET`, and `AI_TIMEOUT_MS` (meeting = 20 min; the meeting call also runs `maxRetries` default since connect-failures are cheap to retry).
- **`lib/ai-log.ts`** — `logRaw(surface, userId)` → logs the raw model text (so "the AI missed X" is debuggable).
- **`lib/prompts/`** — one builder per surface: `voice-intent` / `text-intent` / `image-extraction` (personal capture, `/{voice,text,images}/process`), `team-voice/text/image-delegate` (`/team/*/delegate`), `meeting-intent` (`/meetings/:id/process`), `day-closure-feedback` (`/day-closure/review`), `morning-brief` (`/dashboard/morning-brief`), `transcribe` (`/transcribe`). `shared-rules.ts` holds the reusable rule constants (date resolution, English-output/reasoning, conservative-default, existing-task matching, target-date, priority cues, recommendation-title, names/honorifics, hospital vocabulary, ad-hoc, intent types). `unified-intent.ts` is **parked** (dead path).
- **Graceful degradation:** morning-brief and day-closure return a deterministic fallback on AI failure (never 500). Capture flows still surface a 502 after retries (a soft `degraded` flag is a noted follow-up).

## API surface (current — read `src/routes/v1.ts` + `src/routes/*` for the live list)
All under `/api/v1`, JWT-gated except `/auth/*` and `/livez`/`/readyz`. Standard error shape `{ error: { code, message, details } }`.
- **Auth:** `/auth/signup|login|me`
- **Personal capture:** `/voice/process`, `/text/process`, `/images/process` → `{actions, recommendations[, transcript|extractedText]}`. (`/process` unified is PARKED.)
- **Tasks/Notes/Holidays:** CRUD under `/tasks`, `/notes`, `/holidays`.
- **Day plan/closure:** `/day-plan/submit|get`, `/day-closure/review|submit|:id/mark-reviewed|get`.
- **Team (manager):** `/team/reports`, `/reports/tree`, `/reports/:id/{tasks,submissions}`, `/tasks` (delegate), `/voice|text|image/delegate`, `/users` (create), `/users/attach`, `/users/:id/reset-password`, detach.
- **Meetings:** `/meetings` CRUD, `/meetings/:id/process` (multipart audio+images), `/meetings/:id/recommendations/:index` (status).
- **Dashboard/analytics:** `/dashboard/{overview, departments[CRUD], groups[CRUD+members], people, people/:id, people/:id/day, consistency, trends, meetings, activity, morning-brief(+refresh), reminders, summary-cards, performers, team/tree, directory, analytics/*}`.
- **Org/admin:** `/orgs` (list/create + `/:id/admins`, super-admin), `/users/search`, `/transcribe`, `/activity`.

## Uploads
`middleware/upload.ts` uses **multer `memoryStorage`** (files buffered in RAM), 10MB/file. Meetings allow up to 12 audio + 4 images per request → see GOTCHAS (free-tier memory risk).
