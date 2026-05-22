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

**Sprint 5 — Voice intent service + `/voice/process`** — `Status: implementation complete; smoke tests passing; awaiting user review + commit`. First AI sprint. Detail file: [sprints/05-voice-intent.md](./sprints/05-voice-intent.md). Audio storage deferred to Sprint 6 (per user decision 2026-05-22).

Previous: Sprint 4 — Schema + Pure CRUD (complete, commit `79704d8`). `/simplify` was skipped at user direction.

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
| 06 — Image processing + media | ⏸ not started | — | — | — | *(TBD)* |
| 07 — Day Plan + Day Closure | ⏸ not started | — | — | — | *(TBD)* |
| 08 — Alerts + History | ⏸ not started | — | — | — | *(TBD)* |
| 09 — Polish | ⏸ not started | — | — | — | *(TBD)* |

Sprints 3–9 don't have detail files yet. Per our working style, **detail the next sprint right before starting it**, not all upfront. Each sprint file gets created when the previous one is at the checkpoint.

---

## Active Locks (Who's Working on What)

> Update this when you start work on a file or sprint. Other agents check here before starting overlapping work.

| Resource | Owner | Started | Note |
|---|---|---|---|
| Sprint 5 — Voice intent + `/voice/process` | claude-session | 2026-05-22 | Planning phase — awaiting audio storage decision |

**How to claim a lock:** add a row with `Resource: <file or sprint name>`, `Owner: <session/agent identifier>`, `Started: <ISO timestamp>`, `Note: <one-line context>`. Remove the row when you're done.

---

## Open Blockers

> Things waiting on user input or external action. Tag with the date so we can chase if they age.

| Blocker | Tagged | Resolution waits on |
|---|---|---|
| GCS bucket name + `roles/storage.objectAdmin` on the SA | 2026-05-22 | User to create bucket and grant IAM role. Not blocking until Sprint 6 (image processing + media attachments). |
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

---

## What An Agent Should Do Right Now

If you're a fresh agent session and want to be useful:

1. The next sprint is **Sprint 2 — Repo setup & dev tooling**. It's collaborative; don't start autonomously.
2. **Wait for user to kick it off** by saying something like "let's start Sprint 2" or by giving you concrete tasks.
3. When kicked off, **read [sprints/02-repo-setup.md](./sprints/02-repo-setup.md)** for the task list.
4. Claim the sprint lock above by adding a row to "Active Locks."
5. Work through tasks one at a time, syncing with the user.
6. When done, update the sprint table above and add a changelog entry.
