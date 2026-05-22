---
id: STATE
title: Live Project State
status: live
date: 2026-05-22
tags: [meta, state, coordination]
---

# STATE — Live Project State

> **This file is the coordination point for agents.** Read it at the start of every session. Update it when your work status changes.

---

## Active Sprint

**POC scope complete.** Sprints 1-7 all shipped + committed, plus post-Sprint-7 text/fusion and Sprint 8 lite JWT auth. Sprint 8 Alerts + History remains **deferred indefinitely per user 2026-05-22** - not needed for POC.

Backend-facing integration doc lives at `Backend_task_list/BACKEND_GUIDE.md` (project root, not under `.agents/`) — single source of truth for frontend devs + product owner.

Previous: Sprint 7 — Day Plan + Day Closure (implementation complete, smoke tests green, user committed).

See [sprints/README.md](./sprints/README.md) for the full sprint plan.

---

## Sprint Status Table

| Sprint | Status | Owner | Started | Completed | File |
|---|---|---|---|---|---|
| 01 — Alignment docs | ✅ complete | Claude session | 2026-05-21 | 2026-05-22 | [sprints/01-alignment-docs.md](./sprints/01-alignment-docs.md) |
| 02 — Repo setup & dev tooling | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/02-repo-setup.md](./sprints/02-repo-setup.md) |
| 03 — Foundation infra | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/03-foundation.md](./sprints/03-foundation.md) |
| 04 — Schema + Pure CRUD | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/04-schema-crud.md](./sprints/04-schema-crud.md) |
| 05 — Voice intent + /voice/process | 🟢 ready for review | claude-session | 2026-05-22 | — | [sprints/05-voice-intent.md](./sprints/05-voice-intent.md) |
| 06 — Image processing (image-only) | 🟢 ready for review | claude-session | 2026-05-22 | — | [sprints/06-image-processing.md](./sprints/06-image-processing.md) |
| 07 — Day Plan + Day Closure | ✅ complete | claude-session | 2026-05-22 | 2026-05-22 | [sprints/07-day-plan-closure.md](./sprints/07-day-plan-closure.md) |
| 08 — Alerts + History | 🚫 deferred (POC) | — | — | — | *(skipped per user 2026-05-22)* |
| 09 — Polish | 🚫 deferred (POC) | — | — | — | *(folded into deferred + docs work)* |

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
| S3 bucket name + AWS credentials (access key/secret OR IAM role) | 2026-05-22 | User to provision the S3 bucket and access creds. Blocks any sprint that persists source media (audio/image/video) — currently deferred indefinitely for POC. Storage provider was switched from GCS to S3 on 2026-05-22 per user; see [ADR-0023](./decisions/0023-s3-storage.md) (supersedes ADR-0009). |
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

## What An Agent Should Do Right Now

**POC is complete.** All planned sprints (1-7) are shipped, plus the post-Sprint-7 text + fusion addendum and Sprint 8 lite JWT auth. Sprint 8 Alerts + History remains deferred indefinitely.

If you're a fresh agent session:
1. Read `BACKEND_GUIDE.md` at the project root — that is the single source of truth for what endpoints exist and how they behave.
2. Read `ARCHITECTURE.md` for data model and AI flow details.
3. Check `decisions/` for rationale on any non-obvious design choice.
4. Don't start new work autonomously — wait for explicit user direction.
