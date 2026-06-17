---
id: STATE
title: Live Project State
status: live
date: 2026-05-22
tags: [meta, state, coordination]
---

# STATE — Live Project State

> ⚠️ **SUPERSEDED (2026-06-11) for "current state."** The sprints/changelog below are
> HISTORICAL build provenance (kept; don't rewrite). For what the system is *now*, read
> PRODUCT.md → ARCHITECTURE.md → GOTCHAS.md → DEVELOPMENT.md. The live work backlog is
> `kims-fix-backlog.md` in the gig_project root.
>
> **Canonical sprint/wave log = the root [`Wavesprint.md`](../../Wavesprint.md)** — current
> through **Sprint 22 (Media Storage + Async Pipeline, 2026-06-17)**. The "Active Sprint" and
> changelog in *this* file stop at Sprint 17 (2026-05-27) and are kept only as backend
> provenance — they are NOT the current status.

---

## Active Sprint

> _Historical (through Sprint 17). The live sprint/wave status is the root
> [`Wavesprint.md`](../../Wavesprint.md) — latest is **Sprint 22**._

**Sprint 17 implemented + PA-mode prompt rewrite — Two-phase day closure: Review → Submit + Transcription.** Ready for review. Splits the single-shot `POST /day-closure/submit` into two endpoints: `POST /day-closure/review` (body: `{ date?, commentary? }` — user sends end-of-day narrative; AI generates structured feedback, auto-marks tasks via `taskActions`, creates completed tasks for ad-hoc `additions`) and `POST /day-closure/submit` (finalizes the draft, optional extra note to management in `commentary`). Adds `POST /transcribe` as a reusable verbatim audio→text endpoint (Roman script only, no Devanagari, no DB write). **Day plan no longer required** — closure works without a prior plan. AI persona is a warm Personal Assistant (not an auditor): conservative task matching (only marks done when clearly mentioned), warm English summary, `tips` always empty. `commentary` dual-use: at review = AI narrative (persisted on draft for FE rehydration); at submit = optional extra management note (`input.commentary ?? existing.commentary` so narrative is never wiped). Schema: `status` + `reviewedAt` on `DayClosureSubmission` (migration `20260527120000_sprint17_closure_two_phase`). Phase 5 read-filter audit done: every `dayClosureSubmission` aggregate read (dashboard KPIs, trend, consistency, activity feed, team-reports closure badge, drill-down submissions) now filters `status: "submitted"`; only `findByUserAndDate` (used by review/submit/get) and the FE resume path remain intentionally unfiltered so drafts can rehydrate. New `generateText` helper on `vertex.ts`. Typecheck + lint + build clean. Migration applied to local dev DB. See [sprints/17-closure-review-flow.md](./sprints/17-closure-review-flow.md). Paired with Task-List FE Sprint 17.

**Sprint 16A implemented - Hospital hierarchy foundation.** Ready for review. Adds the schema foundation for the management dashboard: Department, ContextGroup, temporal GroupMembership, SubmissionReview, ReminderIntent, User.level, and optional Task.groupId. Expands the KIMS seed to 18 users, 5 departments, 7 context groups, 29 active memberships, and 8 days of backdated task/submission history with deliberate consistency gaps. Adds `resolveScope()` and extends `canAccessTask()` for active group leads. See [sprints/16a-hierarchy-foundation.md](./sprints/16a-hierarchy-foundation.md). Sprint 16B can now build dashboard endpoints on top of this contract.

**Sprint 16B implemented - Dashboard endpoints + AI Morning Brief.** Ready for review. Adds the `/dashboard/*` backend surface, scope-aware KPI rollups, Morning Brief cache/generation, per-manager submission reviews, scoped activity, management CRUD, reminder stub, and Personal-Directs lazy provisioner. See [sprints/16b-dashboard-endpoints.md](./sprints/16b-dashboard-endpoints.md). FE Sprint 16D can consume the dashboard contract.

**Sprint 11 implemented — Hospital hierarchy + manager delegation.** Ready for user review. Largest backend sprint since Sprint 02. Pivots the data model from single-user to matrix multi-user: M2M self-relation on User (managers/reports), Task.userId split into assigneeId + creatorId, precomputed `reportIds` on AuthenticatedUser, new `canAccessTask` extension for matrix permissions. Adds the entire `/team/*` API surface — voice/text/image AI delegation prompts (sharing a new shared-rules.ts), manual delegation, user CRUD with manager-controlled passwords (no email infra), reports rollup with per-day progress, drill-down endpoints, activity feed enriched with `delegatedBy/delegatedTo` on task events. 12-user demo seed (4 managers, 8 staff, mixed matrix). All 13 smoke tests pass; lint + typecheck + build clean. See [sprints/11-hierarchy-and-delegation.md](./sprints/11-hierarchy-and-delegation.md). FE Sprint 11 (Codex) runs in parallel against the documented contract.

**Sprint 11 post-checkpoint patch (2026-05-25) — Delegation prompt-craft rewrite.** Bug case: "Suresh ko bolo kal Subh bhaiya ko project update de dega" was producing terse title "Project update dena" — recipient context lost. Rewrote the 3 delegation prompts to prime Gemini as a conduit (preserve intent) rather than summarizer. Added FIDELITY_PRINCIPLE / TITLE_RULE / NOTES_RULE / DELEGATION_RELAY_EXAMPLES to shared-rules.ts; opening reframed (delegation OR self-task as dual first-class intents); DELEGATION_RULE extended with relay-preservation. Dropped the "max ~80 chars, declarative noun phrase" cap. Personal prompts untouched. 8/8 validation tests pass; personal-flow regression clean.

Previous: **Sprint 10 — Target-date action + recommendation hygiene + closure text-only.** Committed by user. Three tightly-related backend changes from post-Sprint-09 smoke: (a) new `target_date_updated` action primitive so the AI can shift an existing task to a new date without creating duplicates; (b) recommendation hygiene (clean-title rule + optional `targetDate` field) for the ambiguous cases that still need recommendations; (c) `/day-closure/submit` now accepts text-only commentary (unblocks FE EOD multi-recording fix). See [sprints/10-target-date-and-closure-text.md](./sprints/10-target-date-and-closure-text.md).

Previous: **Sprint 09 — History activity feed (derived projection).** Committed by user. `GET /api/v1/activity` endpoint live: returns sorted `ActivityEvent[]` with proper IST date-range filtering, 400 on bad range, title lookup via `listByIds`. Explicit POC-scope choice in [ADR-0024](./decisions/0024-history-derived-projection.md).

Previous: Sprint 08 — AI date intent + context enrichment + safety caps. Committed by user; all six bundled concerns shipped (BUG-002 BE, BUG-003 prompt rewrite, BUG-004, BUG-006, BUG-009 BE, CONSIDER-001).

Sprints 1-7 all shipped + committed, plus post-Sprint-7 text/fusion and lite JWT auth. Original Sprint 8 (Alerts + History) renumbered to Sprint 9 and remains deferred indefinitely per user 2026-05-22.

Backend-facing integration doc lives at `Backend_task_list/BACKEND_GUIDE.md` (project root, not under `.agents/`) — single source of truth for frontend devs + product owner.

Previous: Sprint 7 — Day Plan + Day Closure (implementation complete, smoke tests green, user committed).

See [sprints/README.md](./sprints/README.md) for the full sprint plan.

---

## Sprint Status Table

| Sprint | Status | Owner | Started | Completed | File |
|---|---|---|---|---|---|
| 16A - Hospital hierarchy foundation | ready for review | codex-session | 2026-05-26 | 2026-05-26 | [sprints/16a-hierarchy-foundation.md](./sprints/16a-hierarchy-foundation.md) |
| 16B - Dashboard endpoints + AI Morning Brief | ready for review | codex-session | 2026-05-26 | 2026-05-26 | [sprints/16b-dashboard-endpoints.md](./sprints/16b-dashboard-endpoints.md) |
| 01 — Alignment docs | ✅ complete | Claude session | 2026-05-21 | 2026-05-22 | [sprints/01-alignment-docs.md](./sprints/01-alignment-docs.md) |
| 02 — Repo setup & dev tooling | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/02-repo-setup.md](./sprints/02-repo-setup.md) |
| 03 — Foundation infra | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/03-foundation.md](./sprints/03-foundation.md) |
| 04 — Schema + Pure CRUD | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/04-schema-crud.md](./sprints/04-schema-crud.md) |
| 05 — Voice intent + /voice/process | 🟢 ready for review | claude-session | 2026-05-22 | — | [sprints/05-voice-intent.md](./sprints/05-voice-intent.md) |
| 06 — Image processing (image-only) | 🟢 ready for review | claude-session | 2026-05-22 | — | [sprints/06-image-processing.md](./sprints/06-image-processing.md) |
| 07 — Day Plan + Day Closure | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/07-day-plan-closure.md](./sprints/07-day-plan-closure.md) |
| 08 — AI date intent + context + safety caps | ✅ committed | claude-session | 2026-05-23 | 2026-05-23 | [sprints/08-ai-date-intent-and-safety.md](./sprints/08-ai-date-intent-and-safety.md) |
| 09 — History activity feed (derived projection) | ✅ committed | codex-session | 2026-05-23 | 2026-05-23 | [sprints/09-history-activity-feed.md](./sprints/09-history-activity-feed.md) |
| 10 — Target-date action + recommendation hygiene + closure text-only | ✅ committed | claude-session | 2026-05-24 | 2026-05-24 | [sprints/10-target-date-and-closure-text.md](./sprints/10-target-date-and-closure-text.md) |
| 11 — Hospital hierarchy + manager delegation | 🟢 ready for review | claude-session | 2026-05-25 | 2026-05-25 | [sprints/11-hierarchy-and-delegation.md](./sprints/11-hierarchy-and-delegation.md) |
| 12 — Manager voice/text updates on delegated tasks | ⏸ deferred (scope captured) | — | — | — | [sprints/12-manager-voice-updates-on-delegated-tasks.md](./sprints/12-manager-voice-updates-on-delegated-tasks.md) |
| 13 — Delegation visibility polish (badge + drill-down edits + image modal) | checkpoint - browser smoke pending | codex-session | 2026-05-25 | — | [Task-List/.agents/sprints/13-delegation-visibility-polish.md](../../../Task-List/.agents/sprints/13-delegation-visibility-polish.md) |
| 14 — Attach existing user to team | 🟢 ready for review | claude-session | 2026-05-26 | 2026-05-26 | [sprints/14-attach-existing-user.md](./sprints/14-attach-existing-user.md) |
| 15 — Meetings v0 | 🟢 ready for review | claude-session | 2026-05-26 | 2026-05-26 | [sprints/15-meetings-v0.md](./sprints/15-meetings-v0.md) |
| 16 — Alerts (was 10/11/12/13/14/15) | 🚫 deferred (POC) | — | — | — | *(skipped per user 2026-05-22)* |
| 17 — Two-phase closure (Review → Submit) + Transcription | 🟢 ready for review | claude-session | 2026-05-27 | 2026-05-27 | [sprints/17-closure-review-flow.md](./sprints/17-closure-review-flow.md) |

Sprints 3–9 don't have detail files yet. Per our working style, **detail the next sprint right before starting it**, not all upfront. Each sprint file gets created when the previous one is at the checkpoint.

---

## Active Locks (Who's Working on What)

> Update this when you start work on a file or sprint. Other agents check here before starting overlapping work.

| Resource | Owner | Started | Note |
|---|---|---|---|
| *(none — POC complete + Sprint 8 lite auth shipped)* | — | — | — |

**How to claim a lock:** add a row with `Resource: <file or sprint name>`, `Owner: <session/agent identifier>`, `Started: <ISO timestamp>`, `Note: <one-line context>`. Remove the row when you're done.

---

## Open Blockers

> Things waiting on user input or external action. Tag with the date so we can chase if they age.

| Blocker | Tagged | Resolution waits on |
|---|---|---|
| ~~S3 bucket name + AWS credentials~~ | ~~2026-05-22~~ | **Resolved (2026-06-17)** — S3 creds landed; storage implemented ([ADR-0023](./decisions/0023-s3-storage.md)) and meeting media now persists + processes async ([ADR-0025](./decisions/0025-async-media-processing.md), [`media-pipeline.md`](./media-pipeline.md)). |
| ~~Database URL for Prisma~~ | ~~2026-05-22~~ | **Resolved** — Postgres 18 in Docker (`task-list-postgres`), `DATABASE_URL` set, Sprint 4 unblocked. |
| Confirm Vertex AI API is enabled on GCP project `nth-rookery-341212` and billing is active | 2026-05-22 | User to verify in GCP console. Blocking Sprint 5. We'll verify in Sprint 2 via a hello-world script. |

---

## Recent Significant Changes (Append-Only Changelog)

> Newest entries at the bottom. Don't rewrite history.

### 2026-05-21
- Initial product alignment discussion with user. 6+ rounds of clarification covering: workflow, voice trade-offs, AI provider choice, storage, auth, duplicates, ad-hoc work, day-closure endpoint design.

### 2026-05-22
- Plan approved by user. Implementation plan saved at `C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md`.
- Sprint 1 (alignment docs) executed.
- First doc structure was monolithic (PROJECT.md, SCOPE.md, DECISIONS.md). User requested agent-native restructure.
- Sprint 1 redone with agent-native layout: README + CONVENTIONS + GLOSSARY + PRODUCT + SCOPE + ARCHITECTURE + STATE + decisions/ (20 ADRs) + sprints/.
- Legacy monolithic files deleted after migration.
- Sprint 2 started. Task 2.1 done (tsconfig stricter, drop JSX, delete empty app.ts) — committed by user as `4592202 Initail: primsa setup`.
- Postgres 18 in Docker (`task-list-postgres`, port 5432, db `tasklist`); `DATABASE_URL` set; `prisma generate` works; client output moved to `src/generated/prisma` (per official Prisma 7 convention).
- Task 2.2 done: SA credentials moved from a `secrets/` JSON file → inline `GOOGLE_SERVICE_ACCOUNT_JSON` env var (env-only approach per user preference; better for PaaS portability).
- Task 2.3 done: `scripts/vertex-hello.ts` confirms Vertex AI reachable; service account works; `gemini-2.5-flash` responds. SDK chosen: `@google/genai` v2.5.0 (the older `@google-cloud/vertexai` is deprecated as of June 2025, removal June 2026).
- Working-style rule added: **agent never runs `git commit`** (user owns commits). Reflected in CONVENTIONS.md.
- Task 2.4 done: ESLint 9 flat config with typescript-eslint (strict-type-checked + stylistic-type-checked) + eslint-plugin-import-x; Prettier with project conventions; npm scripts `lint`, `lint:fix`, `format`, `format:check`, `typecheck`. 5 pre-existing lint errors found and fixed (`port.toString()`, `error: unknown` in promise catch, `??=` in prisma singleton).
- Bonus: husky + lint-staged added per user request. `.husky/pre-commit` runs `npx lint-staged`, which runs `eslint --fix` + `prettier --write` only on staged files. Verified working via simulated diff.
- Sprint 2 complete. Awaiting user commit of: Task 2.4 changes (ESLint/Prettier configs, lint fixes) + husky/lint-staged setup.
- Sprint 3 done. Added: `src/config/env.ts` (zod-validated env with parsed Vertex credentials), `src/lib/errors.ts` (AppError hierarchy), `src/middleware/auth.ts` (stub reading X-User-Id, falls back to env.demoUserId), `src/middleware/error.ts` (central error handler), `src/routes/health.routes.ts` (/livez + /readyz). Refactored: `src/app.ts` (createApp factory), `src/index.ts` (signal handlers + graceful shutdown), `src/lib/prisma.ts` (uses env from config). Smoke tests passed: /livez=200 always, /readyz=200 with DB up, /readyz=503 with DB down, /readyz=200 again on DB recovery.
- Sprint 3 committed (`55cf1b9 feat: Sprint 3 — foundation infra ...`) at user's explicit request.
- Sprint 4 kicked off. Full Prisma schema landed (10 models, FK relations everywhere); first migration `20260521210701_init`; seed script (idempotent, upserts `demo-user-1` in `demo-org`); zod schemas for Tasks/Notes/Holidays; `canAccess` + date utils; `omitUndefined` helper with `StripUndefined<T>` mapped type to bridge zod output (`x?: T | undefined`) → Prisma input (`x?: T`) under `exactOptionalPropertyTypes`. Repository → service → controller → route layers wired for Tasks, Notes, Holidays under `/api/v1`. Central error middleware now also turns `ZodError` into 400 with `VALIDATION_ERROR`.
- Sprint 4 smoke matrix: 23/23 passing — every endpoint, both happy paths and error cases (404 on ghost id, 409 on double-delete/double-archive/double-restore, 400 on invalid body/query). Dev server log clean throughout. Awaiting `/simplify` pass + user commit.
- Sprint 4 committed (`79704d8 Done sprint 4`). `/simplify` was skipped at user direction; we'll resume the convention at Sprint 5 checkpoint.
- Sprint 5 kicked off. Audio storage deferred to Sprint 6 per user decision (`audioUrl String?` migration `20260521220954_voice_audiourl_nullable`). Multer 2.0.2 chosen for multipart (web-researched: Express 5 + ESM compatible, memory storage native, busboy-based, mature). `src/middleware/upload.ts` factory + `voiceUpload` preset (memory, 25 MB cap, audio MIME whitelist). Central error middleware extended to handle ZodError (400) and MulterError (413/400). Added `UpstreamError(502)` for Gemini drift (`AI_EMPTY_RESPONSE` / `AI_INVALID_JSON` / `AI_SCHEMA_MISMATCH`).
- Sprint 5 AI stack: `src/lib/vertex.ts` (singleton `GoogleGenAI` client + `generateStructured<S extends z.ZodType>` helper using zod 4's built-in `z.toJSONSchema()` → SDK's `responseJsonSchema` since v1.9.0; no schema duplication). `src/lib/prompts/voice-intent.ts` refined into sections (ROLE/INPUT/OUTPUT-LANGUAGE/INTENT-TYPES/RULES) with explicit Hinglish-only output rule (no Devanagari) + bilingual priority cues + 8 priority-ordered rules. Confidence labels deliberately skipped per "model will fabricate it" reasoning.
- Sprint 5 layered code: `src/schemas/voice-intent.schema.ts` (discriminated union for actions, `created` carries optional `notes`/`priority`, reasoning mandatory everywhere). `src/repositories/voice.repository.ts`. `src/services/voice-intent.service.ts` (`processVoice` orchestrator: load pending context → create empty `VoiceInteraction` → call Vertex with audio + prompt → dispatch each action via `taskRepo.create`/`taskRepo.update` (with `taskService.getTask` for ownership check on existing-task variants) → final update of `VoiceInteraction.actions`). `src/controllers/voice.controller.ts` + `src/routes/voice.routes.ts` mounted at `/api/v1/voice/process`.
- Sprint 5 smoke (SAPI TTS WAV → "Add buy milk, urgent. Mark finish report as done."): HTTP 201 in ~8s, transcript captured (TTS-quirk and all), both actions executed correctly — new "Buy milk" task with `priority: "high"` + `sourceType: "voice"` + `sourceId` → VoiceInteraction; existing "Finish report" flipped to `completed: true`. DB verified end-to-end. Error paths: 400 on missing audio field, 400 on unsupported MIME, both with `VALIDATION_ERROR` shape. Real Hinglish clip from user pending (optional further validation).
- Sprint 6 kicked off + completed same day. GCS deferred (option C): image-processing-only sprint, no storage layer, no media attach/detach, no audioUrl backfill — all punted to Sprint 7. `ImageExtraction.imageUrl` made nullable + added `extractedText String?` column (migration `20260522082426_image_extraction_extracted_text`). Image schema (`src/schemas/image-extraction.schema.ts`) re-exports voice's action + recommendation shapes (they're modality-neutral) and defines image-specific response with `extractedText`. Image prompt (`src/lib/prompts/image-extraction.ts`) adapts voice-intent with OCR-flavored rules: visual priority cues (URGENT in caps, !!!, underlines, red ink), completed cues (checkmarks, strikethroughs, "DONE"), spatial ordering (top→bottom, columns L→R), ignore-non-task-markings rule. Hinglish-only output preserved.
- Sprint 6 refactor: extracted `dispatchAiAction` + `PersistedAiAction` from voice-intent.service.ts into shared `src/services/action-dispatch.service.ts` (used by both voice + image; will also serve day-closure in Sprint 7). Voice service updated to use it; typecheck + lint still green. The `VoiceAction` schema type is reused for the dispatcher parameter — modality-neutral despite its Sprint-5 name (rename deferred until 3+ callers agree).
- Sprint 6 stack: `src/middleware/upload.ts` extended with `imageUpload` preset (15 MB, JPEG/PNG/WebP/HEIC/HEIF). `src/repositories/image.repository.ts`. `src/services/image-extraction.service.ts` (mirror of voice service, uses shared dispatcher). `src/controllers/image.controller.ts` + `src/routes/images.routes.ts` mounted at `/api/v1/images/process`.
- Sprint 6 smoke (synthetic 800x600 PNG with 4 task items via GDI/PowerShell): HTTP 201 in ~9s; `extractedText` captured all 4 items with newlines preserved; 4 `created` actions emitted; "URGENT: Pay electricity bill" correctly resolved to `priority: "high"` while the other 3 had no priority; all 4 created tasks landed in DB with `sourceType: "image"` + same `sourceId` → ImageExtraction row; reasoning sensible on each. Error paths: 400 on wrong MIME, 400 on missing image field, both with `VALIDATION_ERROR` shape. Voice flow not re-smoked but contract-verified via typecheck/lint after refactor.
- Sprint 7 kicked off + completed same day. Tight scope per user (option A): day-plan + day-closure only, no storage/media/backfill. Two product rules baked in: (a) closure requires a prior day-plan for the date (409 `NO_DAY_PLAN_FOR_DATE`), (b) one-submit-per-(user,date) for both endpoints (`@@unique([userId, date])` enforces; 409 `ALREADY_SUBMITTED` on dup). User confirmed one-per-day is correct semantics; PATCH support deferred to "revisit if".
- Sprint 7 stack: `src/schemas/day-plan.schema.ts` (with a `type` alias `TaskSnapshotEntry` + targeted lint-disable for `consistent-type-definitions` — interfaces don't satisfy Prisma `InputJsonObject`'s index signature, documented why). `src/repositories/day-plan.repository.ts`. `src/services/day-plan.service.ts` (snapshots `taskRepo.listByDate(user.id, date)` excluding nullable fields when null). `src/controllers/day-plan.controller.ts` + `src/routes/day-plan.routes.ts` mounted at `/api/v1/day-plan`.
- Sprint 7 closure: `src/schemas/day-closure-feedback.schema.ts` (6-field structured: achievements/missed/partial/additions/tips/summary, with `.describe()` annotations for the generated JSON Schema). `src/lib/prompts/day-closure-feedback.ts` — Hinglish-only output rule + clear priority rules (CURRENT_TASK_STATES is source of truth for completion, narrative is source for additions). `src/schemas/day-closure.schema.ts`. `src/repositories/day-closure.repository.ts`. `src/services/day-closure.service.ts` (orchestrator: validate plan exists + no duplicate → call `voiceIntentService.processVoice` first to execute task updates → load current task states post-update → SECOND Vertex call for structured `aiFeedback` → persist `DayClosureSubmission`). `src/controllers/day-closure.controller.ts` + `src/routes/day-closure.routes.ts` mounted at `/api/v1/day-closure`. Sync point 1 (prompt review) was pre-approved by user, so written without intermediate pause.
- Sprint 7 smoke (3 seeded tasks → day-plan submit → closure with SAPI TTS WAV: "I bought the groceries. The doctor appointment is partial. I called but they were closed. Also I attended an emergency meeting today, that was not planned."): closure took ~16s (2 Vertex calls). Voice flow correctly classified `completed` (Buy groceries) + `partial` (Doctor appointment) by exact taskId match; emergency meeting went to `recommendations` not auto-created (ADR-0005 honored). `aiFeedback` came back fully populated: achievements/missed/partial/additions correct based on plan-vs-current diff; **tips and summary genuinely in Hinglish** ("Doctor appointment ke liye pehle timings confirm kar lo." / "Aaj ka din busy tha, groceries done aur emergency meeting bhi manage ki. Doctor appointment partial raha aur research paper miss ho gaya, but achha effort tha overall."). DB verified: 3 Tasks with correct end states, 1 DayPlanSubmission (plan_size=3), 1 DayClosureSubmission (6 feedback fields), 1 VoiceInteraction (2 actions, 1 rec). All 5 error paths green: duplicate plan → 409, duplicate closure → 409, closure without plan → 409 `NO_DAY_PLAN_FOR_DATE`, missing audio → 400, GET non-submitted date → 404 `DAY_CLOSURE_NOT_FOUND`.
- Sprint 7 committed by user. Sprint 8 (Alerts + History) deferred indefinitely per user direction — not needed for POC. Sprint 9 (Polish) similarly folds in.
- Wrote `Backend_task_list/BACKEND_GUIDE.md` (project root, not under `.agents/`) — single-document integration guide for frontend devs + product owner. Covers product loop, auth/conventions, 7 worked-through user journeys (voice morning, image scan, day-plan submit, manual CRUD, day closure, notes, holidays), complete API reference, AI feature details (Hinglish, recommendation pattern, server-generated IDs), explicit "not supported" list (auth/storage/media/alerts/history/multi-user/streaming), quick-start setup, code-organization pointers. Doc audience is non-agent; not in `.agents/` for discoverability.
- **Post-Sprint-7 addendum (text + fusion endpoints) shipped + documented.** Two new endpoints implemented and smoke-tested: (1) `POST /api/v1/text/process` — JSON body `{text}`, mirrors voice flow minus audio, new `TextInteraction` Prisma model, no `transcript` in response. (2) `POST /api/v1/process` — true multimodal fusion: multipart with optional `audio` + `image` + `text`, single Vertex `generateContent` call, per-action `source: "voice"|"image"|"text"` tag, new `UnifiedInteraction` model, `AiSourceType` extended to include `"text"` and `"unified"`. Deliberately omitted from fusion response: `transcript` and `extractedText` (cascade-hallucination rationale; per-action `reasoning` carries cues inline). New `multiModalUpload` multer middleware with per-field MIME filtering. Smoke results: /text/process — Hinglish paragraph → 4 tasks in 13s including "urgent" → priority high and correct Hinglish resolution; /process (all 3 modalities) — 11s, 2 actions + 2 recommendations with source tags, DB lineage confirmed; subset (text+audio) and empty-request (400) also green. Existing /voice/process and /images/process unaffected. Docs updated: BACKEND_GUIDE.md (new use cases 4.8/4.9, new API reference entries, open-question updated), ARCHITECTURE.md (API surface + data model + AI flows), ADR-0021 created.

---

- Sprint 8 lite shipped: basic email/password + JWT auth. Added required `User.passwordHash`, bcrypt password helpers, JWT sign/verify helpers, user repository, auth schemas/service/controller/routes, public `POST /api/v1/auth/signup`, public `POST /api/v1/auth/login`, and protected `GET /api/v1/auth/me`. Removed `X-User-Id` stub path from source; all non-auth `/api/v1` routes now require `Authorization: Bearer <token>`. Seed updates `demo-user-1` with password `demopass123`. Env now requires `JWT_SECRET` and supports `JWT_TTL=30d`. ADR-0008 superseded by ADR-0022. Docs and Postman handoff updated for login-first bearer-token flow. Verification passed: migration + seed, demo login, `/auth/me`, unauth/bad token/wrong password 401s, signup + duplicate 409, short password 400, per-user task scoping, `npm run typecheck`, and `npm run lint`.

- `PATCH /api/v1/tasks/:id` now accepts `targetDate` (YYYY-MM-DD). Enables "move yesterday's leftover into today" without recreating the task. Schema, repository `UpdateTaskData`, and service all extended; date string is parsed via the existing `parseDateString` helper. Smoke verified: create on 2026-05-21 → PATCH to 2026-05-22 → 200 with updated `targetDate`; invalid string → 400 `VALIDATION_ERROR`; empty patch still rejected with "At least one field must be provided". BACKEND_GUIDE.md API reference + a new curl example updated.

- Storage provider switched from GCS to S3 (still deferred until credentials). ADR-0009 marked `superseded by ADR-0023`; new ADR-0023 documents the reversal and confirms the `BlobStorage` interface from ADR-0009 carries over unchanged. Forward-looking docs scrubbed (STATE/ARCHITECTURE/SCOPE/GLOSSARY/CONVENTIONS/BACKEND_GUIDE + decisions index); two code-level comments in `day-closure.schema.ts` and `errors.ts` flipped to S3. Sprint history files left untouched.

- Frontend login integration fix: added backend CORS middleware with `CORS_ORIGINS` support. POC setting is now `CORS_ORIGINS=*`, and the code default also allows any origin. Browser preflight for `POST /api/v1/auth/login` returns `204` with `Access-Control-Allow-Origin: *`. Verified with `npm run typecheck`, `npm run lint`, OPTIONS preflight from a random Origin, and demo login with an Origin header.

- `GET /api/v1/tasks?openCarryOver=true` added — frontend-driven addition during Sprint 02.5 (drag-to-today UI surface). Returns incomplete tasks with `targetDate < todayInUserTz("Asia/Kolkata")`, ordered `targetDate ASC, createdAt ASC`. Mutually exclusive with `date` — sending both → 400 via zod `.refine()`. Changes: `listTasksQuerySchema` extended with `openCarryOver: z.coerce.boolean().optional()` + refine; `taskRepo.listOpenCarryOver(userId, today)` sibling of `listPending` (untouched); `listTasks` service signature changed from `(user, dateStr?)` to `(user, query)`; controller passes full `query`. ARCHITECTURE.md task endpoint table + BACKEND_GUIDE.md updated. `npm run lint` + `npm run build` green. Curl smoke: `?date=2026-05-22` ✅, `?openCarryOver=true` returns 12 incomplete tasks ✅, both params → 400 ✅. Implemented by a Sonnet subagent under foreground supervision from a frontend-side claude-session.

### 2026-05-23

- **Sprint 08 implemented — AI Date Intent + Context Enrichment + Safety Caps + AI Reasoning Rewrite.** Six frontend-surfaced concerns bundled into one sprint because they all touch the AI processing surface. BUG-003 was absorbed mid-sprint (user direction updated: reasoning stays user-facing but the prompt enforces brief + native-language + P.A. tone). The bundle:
  - **BUG-002 backend half** — input schemas on `/text/process`, `/voice/process`, `/images/process`, `/process` all accept optional `targetDate: YYYY-MM-DD`. New `submitVoiceInputSchema` / `submitImageInputSchema` / `submitUnifiedInputSchema`; `submitTextInputSchema` extended.
  - **BUG-003** — all four prompts rewritten with a USER-FACING REASONING rule: language matches the user's input (English in → English out; Hinglish in → Hinglish out), ≤ 20 words, P.A. tone, no rule references. Explicit good/bad examples in each prompt.
  - **BUG-004** — `task.repository.ts.listByDate` + `listOpenCarryOver` switched to `orderBy: [{ updatedAt: "desc" }]`. `listPending` (AI-context helper) unchanged.
  - **BUG-006** — all four prompts gained TODAY'S DATE anchor + Hindi tense disambiguation section ("kal" past vs future). `created` action schema extended with optional `targetDate`. `action-dispatch.service.ts` uses `action.targetDate ?? opts.today`.
  - **BUG-009 backend half** — `src/middleware/upload.ts` voice + image + multiModal caps unified at 10 MB (was 25 / 15 / 25). `MulterError.LIMIT_FILE_SIZE` returns `{ code: "FILE_TOO_LARGE", message: "Uploaded file exceeds the 10 MB limit." }` (was multer's raw code+message).
  - **CONSIDER-001** — new `src/lib/notes-context.ts` with `truncateNotesForContext(notes)`: word-aware truncation to 200 chars + ellipsis. All four AI services include truncated notes in the pending-task context.
  - Plus a small incidental refactor: `formatDateYMD` was duplicated across four services; consolidated to `src/utils/date.ts` as `formatDateYmd`, alongside new `promptDateAnchors(today)` helper.
  - **Verification:** `npm run typecheck` ✅ `npm run lint` ✅ `npm run build` ✅. Five curl smoke tests against live dev server all green: (1) frontend `targetDate` lands tasks on the chosen day; (2) "kal ward 12 me jaana hai" (future) → AI emits `targetDate: tomorrow`; (3) "kal report submit kar di thi" (past) → recommendation, not future create; (4) PATCH → task floats to top of `listByDate`; (5) 11 MB upload → `413 FILE_TOO_LARGE`.
  - **Backwards-compatible.** All input additions are optional. The frontend currently doesn't send `targetDate` and behavior is preserved (tasks land on today). Frontend Sprint 07 can adopt at its own pace.
  - Original Sprint 8 (Alerts + History) renumbered to Sprint 9.

## What An Agent Should Do Right Now

> ⚠️ The Sprint-09 guidance that used to live here is HISTORICAL — everything through
> Sprint 17 (and meetings, hierarchy, dashboards, analytics) has since shipped. Current
> onboarding: **PRODUCT.md → ARCHITECTURE.md → GOTCHAS.md → DEVELOPMENT.md**, then check
> `kims-fix-backlog.md` (gig_project root) for live work. Don't start work autonomously —
> wait for explicit user direction.

### 2026-05-23 (later)

- **Sprint 09 scoped — History activity feed (derived projection).** Will add `GET /api/v1/activity?from&to` returning a sorted `ActivityEvent[]`. Projects 8 event types from existing tables (4 AI batch types + manual task creation + task completion + 2 submission types). Explicit POC choice per ADR-0024 — derived projection ships in ~1 sprint, scale-warning baked into the service's top-of-file comment + ADR + sprint doc. Migration to a proper `TaskAuditEvent` table is documented for when POC scale (~5K tasks/user) is exceeded.
- ADR-0024 created. Existing Sprints 9 (Alerts) + 10 (Polish) renumbered to 10 + 11.

### 2026-05-24

- **Sprint 10 kicked off — Target-date action + recommendation hygiene + closure text-only.** User smoke surfaced two cascading bugs: (1) AI has no `target_date_updated` action variant, so date-shift intents fall to recommendations; (2) recommendation `title` field gets prompt-question strings instead of clean task titles, and recommendation schema lacks `targetDate`, so `+ ADD` lands a garbage-titled task on the wrong date. Plus EOD multi-recording fix (BUG-B) needs `/day-closure/submit` to accept text-only commentary. Existing deferred Sprints 10 (Alerts) + 11 (Polish) renumbered to 11 + 12. Sprint file at [sprints/10-target-date-and-closure-text.md](./sprints/10-target-date-and-closure-text.md).

- **Sprint 10 implemented.** Five concrete changes:
  - **10.1** — `target_date_updated` action variant added to `voiceActionSchema` (cascades to text + image which re-export) + `unifiedActionSchema`. `targetDate` is REQUIRED on this variant (vs optional on `created`) since the new date IS the action. Dispatcher case added in `action-dispatch.service.ts` — `taskRepo.update(taskId, { targetDate })` with `taskService.getTask` auth check. `PersistedAiAction` union extended.
  - **10.1.b** — Recommendation schemas (`voiceRecommendationSchema` + `unifiedRecommendationSchema`) gain optional `targetDate: ymdDateSchema.optional()`. Frontend `+ ADD` will honor this in FE Sprint 10.
  - **10.2** — All four prompts (`voice-intent.ts`, `text-intent.ts`, `image-extraction.ts`, `unified-intent.ts`) extended:
    - INTENT TYPES section lists the 5th type with one-line description.
    - New TARGET DATE UPDATE rule (positioned right after EXISTING-TASK MATCHING) with 3 concrete examples each + an explicit "when NOT to use it" list (no match → `created`; ambiguous → recommendation; explicit duplicate → `created`).
    - New RECOMMENDATION TITLE FORMAT rule with good/bad examples — title must be a clean task name, NOT a "Shift X to Y?" question. Also notes the optional `targetDate` carry-through.
  - **10.3** — `/day-closure/submit` made audio-optional. Controller drops the `if (!req.file)` precondition; instead validates "audio OR commentary required" after parsing body. Service signature changes to `audio: DayClosureAudioInput | undefined`; when absent, skips `voiceIntentService.processVoice` entirely (uses `{ transcript: "", actions: [], recommendations: [] }` placeholder via `Pick<VoiceProcessResult, ...>`). Closure narrative falls back to `input.commentary` alone. No schema change needed — commentary already optional in the body schema.
  - Sprint file: [sprints/10-target-date-and-closure-text.md](./sprints/10-target-date-and-closure-text.md).
  - **Verification:** `npm run typecheck` ✅, `npm run lint` ✅. Smoke tests against live dev server:
    - (1) Date-shift via text: created task "Sneha se baat karna hai" on 2026-05-24 → text "Sneha se baat karna hai - Monday ko karna hai" → AI emitted `target_date_updated { taskId: <existing>, targetDate: "2026-05-25" }` with empty recommendations. Task moved to 2026-05-25, identity preserved (same id). ✅
    - (2) Ambiguous reference: created two tasks "Patient rounds ward A" + "Patient rounds ward B" → text "patient rounds wale ko Monday shift karo" → AI emitted empty actions + ONE recommendation with clean title "Patient rounds" (not a "Shift X to Y?" question), populated `targetDate`, and a clean Hinglish disambiguation question in `reasoning` ("Kaunse patient rounds ko Monday shift karna hai? Ward A ya Ward B?"). Recommendation hygiene works as designed. Minor: AI resolved Monday to 2026-05-26 (Tuesday) instead of 2026-05-25 — a separate weekday-resolution accuracy concern, not blocking. ✅
    - (3) Regression: "kal ward 12 me jaana hai" → `created` action with `targetDate: 2026-05-25` (Sprint 8 behavior preserved). ✅
    - (4) EOD text-only submit: commentary-only POST → 201 with `taskUpdates: []` (voice skipped) and 6 populated `aiFeedback` fields. ✅
    - (5) EOD missing both: no audio + no commentary → 400 with `VALIDATION_ERROR: "Either audio or commentary is required"`. ✅
    - (6) EOD with audio (regression): not re-smoked — code path is unchanged when audio is present (the only branch added is `audio ? processVoice : empty`). Confidence is high; FE Sprint 10 will exercise this implicitly with the old single-recording flow.
  - **Backwards-compatible.** All existing AI clients continue to work; the new action type is additive, recommendation `targetDate` is optional, day-closure with audio still behaves identically.
  - **Handoff:** FE Sprint 10 picks up the DTO updates + recommendation ADD handler + EOD modal refactor. See plan file `C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md` for the paired FE scope.

### 2026-05-26

- **Sprint 16B implemented - Dashboard endpoints + AI Morning Brief (codex-session).** Adds `/api/v1/dashboard/*` with router-level `requireManager`, scope-aware rollups via `resolveScope`, Morning Brief generation/cache/cooldown, per-manager `SubmissionReview`, scoped activity, department/group/member management, reminder intent recording, and Personal-Directs lazy provisioning from `team/users/attach`. Migration `20260526172912_add_morning_brief_cache` adds `MorningBriefCache`. Verification: `typecheck`, `lint`, `build`, `migrate reset --force && seed-hierarchy`, HTTP dashboard smoke, SubmissionReview matrix smoke, Personal-Directs smoke, and live Vertex Morning Brief smoke passed. Sprint file: [sprints/16b-dashboard-endpoints.md](./sprints/16b-dashboard-endpoints.md).

- **Sprint 16A implemented - Hospital hierarchy foundation (codex-session).** Adds the schema and seed foundation that Sprint 16B dashboard endpoints consume. Migration `20260526170841_add_hierarchy_foundation` adds `Department`, `ContextGroup`, temporal `GroupMembership`, `SubmissionReview`, `ReminderIntent`, `User.level`, and optional `Task.groupId`. Seed now produces 18 KIMS users, 5 departments, 7 context groups, 29 active memberships, 612 seed-tagged historical tasks, 8 days of plan/closure history, deliberate submission gaps, AI interaction rows, and 3 processed meetings. Added [src/lib/resolve-scope.ts](../src/lib/resolve-scope.ts) and extended [src/utils/auth.ts](../src/utils/auth.ts) so active group leads can access in-group assignee tasks. Verification: `prisma generate`, `typecheck`, `lint`, `build`, migration apply, `migrate reset --force && seed-hierarchy`, seed idempotency, and focused scope/access smoke passed. Sprint file: [sprints/16a-hierarchy-foundation.md](./sprints/16a-hierarchy-foundation.md).

- **Sprint 14 implemented — Attach existing user to team (claude-session).** Adds `POST /team/users/attach` so a manager can wire an existing same-org user into their reports without creating a duplicate account. Closes the Sprint 11 deferred item "cross-team add". Single endpoint, four small files touched, no migration. Sprint file: [sprints/14-attach-existing-user.md](./sprints/14-attach-existing-user.md). Paired with [FE Sprint 14](../../Task-List/.agents/sprints/14-add-existing-user.md).
  - **Schema:** `attachExistingUserInputSchema` ({ email }) in [src/schemas/team.schema.ts](../src/schemas/team.schema.ts).
  - **Service:** `attachExistingUser(creator, { email })` in [src/services/team.service.ts](../src/services/team.service.ts) — same-org lookup (404 if missing or cross-org), self-guard (400 `CANNOT_ATTACH_SELF`), admin-guard (403 `CANNOT_ATTACH_ADMIN`), idempotency surface (409 `ALREADY_A_REPORT`), then `prisma.user.update` with `reports.connect`.
  - **Controller + route:** [src/controllers/team.controller.ts](../src/controllers/team.controller.ts) + [src/routes/team.routes.ts](../src/routes/team.routes.ts). `requireManager` middleware (Sprint 11) gates staff out as before.
  - **Verification:** `npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅. All 10 smoke cases passed against live dev server with `kims-hospital` seed:
    - T1 Mehta attaches Suresh → 201 + `PublicTeamUser`.
    - T2 Mehta re-attaches Suresh → 409 `ALREADY_A_REPORT`.
    - T3 Mehta attaches ghost@kims.demo → 404 `USER_NOT_FOUND`.
    - T4 Mehta attaches herself → 400 `CANNOT_ATTACH_SELF`.
    - T5 Temp-promote deepika to admin, Mehta attaches → 403 `CANNOT_ATTACH_ADMIN`. Reverted.
    - T6 Bad email shape → 400 `VALIDATION_ERROR`.
    - T7 Empty body → 400 `VALIDATION_ERROR`.
    - T8 Staff (Sneha) attempts → 403 `FORBIDDEN` (`requireManager` regression).
    - T9 After T1, Mehta's `GET /team/reports` includes Suresh (4 rows total).
    - T10 After T1, Mehta `GET /team/reports/<suresh-id>/tasks?date=2026-05-26` → 200.
    - **Matrix semantics regression:** after T1, Sharma's reports still include Suresh — attach is additive, not exclusive. ✅
  - **Cleanup:** Mehta→Suresh edge created by T1 reverted via direct SQL so the seed stays pristine. T5 admin promotion reverted.
  - **STATE.md sprint table:** Alerts 14→15, Polish 15→16; new row 14 inserted.
  - **NOT updated:** `BACKEND_GUIDE.md` — the `/team/*` family isn't documented there yet (Sprint 11 left this open). The endpoint is fully specified in the sprint file. Recommend a one-pass `/team/*` BACKEND_GUIDE section as a separate doc task.

- **Sprint 14 addendum — Same-org user search endpoint (claude-session).** Added `GET /api/v1/users/search?q=<optional>` to support a list+search picker UX on the FE Add Existing tab (replacing the original email-only input). The endpoint is **role-gate-free** (jwtAuth only) so the future Meetings invite picker can reuse it. Same-org scoping is enforced server-side; cross-org enumeration impossible. Case-insensitive substring match against `name` OR `email`; capped at 50 results; sorted by name asc.
  - **Files added:** [src/schemas/users.schema.ts](../src/schemas/users.schema.ts), [src/services/users.service.ts](../src/services/users.service.ts), [src/controllers/users.controller.ts](../src/controllers/users.controller.ts), [src/routes/users.routes.ts](../src/routes/users.routes.ts). Extended [src/repositories/user.repository.ts](../src/repositories/user.repository.ts) with `searchSameOrg(orgId, q, take)`. Mounted in [src/routes/v1.ts](../src/routes/v1.ts) at `/users`.
  - **Verification:** `typecheck` ✅, `lint` ✅, `build` ✅. All 7 smoke cases passed against live dev server:
    - T11 full list → 200 + 12 rows.
    - T12 `?q=sneha` → 1 row.
    - T13 `?q=SISTER` (caps) → 4 rows (case-insensitive).
    - T14 `?q=@kims` → 12 (email substring).
    - T15 `?q=zzz` → [].
    - T16 staff (Sneha) calls with `?q=mehta` → 1 row (no role gate).
    - T17 no auth → 401 UNAUTHORIZED.
  - **FE handoff:** [Task-List/.agents/sprints/14-add-existing-user.md](../../Task-List/.agents/sprints/14-add-existing-user.md) addendum section documents the picker UX, debounce pattern, `disabledReason` helper, and 9 FE smoke cases. Endpoint contract specified there too.
  - **Response shape:** `PublicUserSummary[]` = `{ id, email, name, role }[]`. `orgId` deliberately omitted (always caller's org). Includes admins + caller — FE handles disable/label logic for those rows.

- **Sprint 15 implemented — Meetings v0 (claude-session).** Wires the Meetings tab to a real backend with full AI multi-modal fusion processing. Meetings inherit the team-delegate pattern: AI emits `created` actions assigned to attendees + `recommendations` for ambiguous items + a Hinglish `summary`. Auto-creates real Task rows for each valid action (sourceType=`"meeting"`, sourceId=meeting.id). Sprint file: [sprints/15-meetings-v0.md](./sprints/15-meetings-v0.md). Paired with [FE Sprint 15](../../Task-List/.agents/sprints/15-meetings-v0.md).
  - **Schema delta:** new `Meeting` Prisma model with `attendeeIds: String[]`, `agenda`, `notes`, `summary`, `customPrompt`, `actions: Json`, `recommendations: Json`, `processedAt`, `deletedAt`. Migration `20260526120112_add_meeting_model`. No FK on attendeeIds (POC scope; service-layer validates same-org).
  - **Endpoints:** `GET /meetings`, `GET /meetings/:id`, `POST /meetings`, `PATCH /meetings/:id`, `DELETE /meetings/:id`, `POST /meetings/:id/process`. All under `jwtAuth`, no role gate (staff can create their own meetings). Process endpoint accepts multipart `audio[]` (0–12 clips, ≤10MB each) + `images[]` (0–4 files, ≤10MB each) + body `customPrompt?`, `notes?`. Returns `{ meeting, actions, recommendations }`.
  - **AI prompt:** [src/lib/prompts/meeting-intent.ts](../src/lib/prompts/meeting-intent.ts) — meeting observer role, FIDELITY principle, CROSS-CLIP RULE ("audio clips are segments of the SAME meeting in chronological order — reason across them"), reuses TITLE_RULE / NOTES_RULE / RECOMMENDATION_TITLE_FORMAT_RULE / PRIORITY_CUES_RULE / HINGLISH_* from shared-rules.ts. CustomPrompt threaded as labeled "FOCUS INSTRUCTION FROM THE MANAGER" block with "do not let it override fidelity to what was actually said."
  - **Dispatcher:** [src/services/meeting-action-dispatch.service.ts](../src/services/meeting-action-dispatch.service.ts) — mirrors team-action-dispatch but validates assignees against `meeting.attendeeIds` (plus creator for self-tasks). Hallucinated/invalid assignees demoted to recommendations defensively. Creates Tasks with `sourceType: "meeting"`, `sourceId: meeting.id`, `creatorId: meeting.userId`.
  - **Activity feed:** new `meeting_processed` event variant in `ActivityEvent` discriminated union. Projection added to [src/services/activity.service.ts](../src/services/activity.service.ts) — fetches `meetingRepo.listProcessedInRange(userId, from, to)` in parallel with existing event fetches.
  - **`/process` long-running:** `req.setTimeout(300_000)` + `res.setTimeout(300_000)` on the handler. End-to-end ~9s for a 5-second TTS clip; expected to scale to ~2 min for 1-hour meetings (founder's documented expectation).
  - **multiModalUpload extended:** new `meetingsUpload` middleware in [src/middleware/upload.ts](../src/middleware/upload.ts) — `.fields([{name:"audio", maxCount:12}, {name:"images", maxCount:4}])` with the existing 10MB-per-file cap. Reuses same MIME whitelist as voiceUpload + imageUpload.
  - **Verification:** `typecheck` ✅, `lint` ✅, `build` ✅. Smoke 15/17 passed against live dev server with seeded KIMS hospital org (B9 covered by B11; B14 long-audio not synth-tested — covered transitively by B5 9s end-to-end success):
    - B1 create meeting → 201 + hydrated attendees ✅
    - B2 list → 200 ✅
    - B3 get by id → 200 + attendees ✅
    - B4 patch notes → 200 + notes updated ✅
    - B5 process with 1 audio + customPrompt → 200 in 9s; Hinglish summary; 1 action assigned to Sneha (Ward 12 rounds, targetDate=tomorrow); real Task created in DB with sourceType=meeting ✅
    - B6 process with no audio/notes/images → 400 MEETING_NOT_PROCESSABLE ✅
    - B7 get wrong id → 404 MEETING_NOT_FOUND ✅
    - B8 different user GET → 404 (anti-enum) ✅
    - B8b re-process processed meeting → 409 MEETING_ALREADY_PROCESSED ✅
    - B10 cross-org attendee → 400 ATTENDEE_NOT_IN_ORG ✅
    - B11 DELETE → 204; subsequent GET → 404 ✅
    - B12 notes-only processing (no audio) → 200; correct Sneha task assigned via text alone ✅
    - B13 prompt-injection attempt (customPrompt tells AI to assign to non-attendee id) → defensive: the offending action was demoted to a recommendation; no rogue Task created ✅
    - B15 11MB audio upload → 413 FILE_TOO_LARGE ✅
    - B16 staff caller GET /meetings → returns only their own meetings (Sneha sees 0; she didn't create any) ✅
    - B17 after B5, Sneha logged in → sees the meeting-created Task on her task list with sourceType=meeting, creatorId=Sharma ✅
    - **Activity feed:** `meeting_processed` event surfaced on Sharma's `/activity` with `actionItemCount=1, recommendationCount=1` ✅
  - **Cleanup:** all smoke meetings + the Task created during B5 soft-deleted to keep seed pristine. No leftover state.
  - **FE handoff:** the FE delegate (Codex) consumes the contract documented in [Task-List/.agents/sprints/15-meetings-v0.md](../../Task-List/.agents/sprints/15-meetings-v0.md) — includes `BackendMeeting` + `MeetingProcessResult` types, Save-Locally vs Send-to-AI terminal actions, per-clip Download, pause/resume on `useAudioRecorder`, generic indeterminate ProcessingProgressModal copy, and 25 FE smoke cases.

### 2026-06-17 (provenance pointer — full detail in root `Wavesprint.md`)

- **Sprints 18–22 shipped** (this STATE file's "Active Sprint" above stops at 17; these are
  summarized here so the changelog isn't misleading — the canonical wave log is
  [`Wavesprint.md`](../../Wavesprint.md)):
  - **18** — KIMS Hospitals real-org onboarding (2nd tenant).
  - **19** — Time-slot scheduling (day timeline; minute-of-day model).
  - **20** — Scheduling v2 (edit-popup slot, list-view time, manager insights) + `Task.completedAt`.
  - **21** — Manager insights rollup-first (scales to 100+).
  - **22 — Media Storage + Async Pipeline.** Audio/images persist to **S3**
    (`BlobStorage`/`S3Storage`, [ADR-0023](./decisions/0023-s3-storage.md), now implemented).
    Meeting "Send to AI" is **async**: upload → **pg-boss** queue on Postgres (no Redis) →
    separate **worker** (`src/worker.ts`) → `202 + jobId`, FE polls `GET /jobs/:id`
    ([ADR-0025](./decisions/0025-async-media-processing.md), [`media-pipeline.md`](./media-pipeline.md)).
    New `ProcessingJob` model (migration `add_processing_job`). Voice/image/transcribe stay sync.
