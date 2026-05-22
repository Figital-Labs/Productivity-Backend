---
id: SPRINT-05
title: Sprint 5 — Voice intent service + `/voice/process`
status: in_progress
owner: claude-session
started: 2026-05-22
completed: null
tags: [sprint, ai, vertex, voice]
related: [ARCHITECTURE, ADR-0001, ADR-0003, ADR-0005]
---

# Sprint 5 — Voice intent service + `/voice/process`

## Goal

First AI sprint. Ship `POST /voice/process`: client uploads an audio clip → Gemini 2.5 Flash classifies what the user wants per phrase → backend executes via the existing repository methods → returns `{ transcript, actions, recommendations }` → persists a `VoiceInteraction` audit row.

**Critical product principle reaffirmed (ADR-0001):** AI is sugar on conventional CRUD. Every voice-driven action calls the same repository methods Sprint 4 wired up. The voice endpoint *decides what to do*; Sprint 4's code *does it*. If voice misbehaves, the manual CRUD path is unaffected.

## Audio storage strategy (decided 2026-05-22)

**Defer real audio storage to Sprint 6.** Audio is streamed to Gemini as inline bytes; we don't persist the file in Sprint 5. `VoiceInteraction.audioUrl` becomes nullable (small migration). Sprint 6 lands the `BlobStorage` interface + GCS impl alongside image media; that's when voice clips get retrievable URLs for replay/audit.

If a blocker forces us to round-trip audio through storage in Sprint 5, local `./uploads/` (gitignored) is the agreed fallback — mirroring the local-Postgres-in-Docker pattern from Sprint 2. Replace with GCS in Sprint 6.

## Non-goals (deferred)

- Image input → Sprint 6 (audio-only this sprint)
- Real GCS persistence → Sprint 6
- Day plan / closure flows → Sprint 7
- Idempotency-Key middleware → defer until we measure a real duplicate-submission problem
- Confidence threshold tuning, cross-modal contradiction detection, per-action provenance → revisit per the hallucination-control levers discussion if needed; recommendation pattern (ADR-0005) is doing the safety lifting for now

## Sync points (where I pause for you)

1. **Before installing multer (or whatever multipart lib)** — I'll web-research current state + confirm choice. Maturity matters for an Express 5 + ESM project.
2. **Before writing the Gemini prompt** — I'll show you the prompt + output schema for a sanity check. Prompt design is the highest-leverage decision in this sprint.
3. **Before wiring controller/route** — show layered code so the shape is approved once for future AI sprints.
4. **Smoke test** — you'll need to provide a short voice clip (5–15s) saying things like *"add 'buy milk' to my list, that one's urgent"* and *"mark the smoke test task as done"*. WebM / WAV / MP3 / OGG all work with Gemini.

## Tasks

### 5.1 — Schema migration: nullable `audioUrl`
- Change `VoiceInteraction.audioUrl String` → `String?`.
- `npx prisma migrate dev --name voice_audiourl_nullable`.
- One-line schema change, fast migration.

### 5.2 — Multipart upload middleware
- Web-research current options for Express 5 + ESM. Likely candidates: `multer` v2, `formidable`, `busboy`. (Per CONVENTIONS, don't trust training data on this — verify.)
- `src/middleware/upload.ts` — memory storage (audio bytes go inline to Gemini, no disk needed for this sprint).
- Limits: 25MB max, audio MIME types only (allow common ones — `audio/webm`, `audio/wav`, `audio/mpeg`, `audio/ogg`, `audio/mp4`).

### 5.3 — Vertex client wrapper
- `src/lib/vertex.ts` — `@google/genai` v2.5.0 singleton, configured with `vertexai: true` + `googleAuthOptions: { credentials: env.gcp.credentials }`.
- Tiny surface: one `generateStructured({ model, parts, schema, prompt })` helper that handles JSON-mode and returns a parsed-then-zod-validated object.
- Prompts live in `src/lib/prompts/` (separated from client so they can be iterated independently and read in isolation).

### 5.4 — Voice intent prompt + output schema
- `src/lib/prompts/voice-intent.ts` — system prompt + few-shot examples for classifying user phrases into `created` / `priority_updated` / `completed` / `partial` / `recommendation`. Includes the rule from [ADR-0005](../decisions/0005-recommendation-pattern.md) (low confidence → recommendation, not action).
- `src/schemas/voice-intent.schema.ts` — zod schema for the model output. Used for (a) the Gemini structured-output config and (b) post-call validation.
- Output shape (per ARCHITECTURE):
  ```
  { transcript: string,
    actions: Array<
      | { type: "created", title, priority?, targetDate?, reason? }
      | { type: "priority_updated", taskId, priority, reason? }
      | { type: "completed", taskId, reason? }
      | { type: "partial", taskId, reason? }
    >,
    recommendations: Array<{ title, priority?, reasoning }>
  }
  ```

### 5.5 — Voice interaction repository
- `src/repositories/voice.repository.ts` — `create(data)` and `updateActions(id, actions)` only. Pure persistence.

### 5.6 — Voice intent service (the shared classifier)
- `src/services/voice-intent.service.ts` — framework-agnostic. Steps:
  1. Load top N pending tasks for context (`taskRepo.listPending(user.id, 50)`).
  2. Create empty `VoiceInteraction` row → grab its id (so created tasks can reference it via `sourceId`).
  3. Call `vertex.generateStructured` with audio bytes + context + prompt.
  4. Dispatch each action to `taskRepo` (create/update). For `created`, set `sourceType: "voice"` + `sourceId: voiceInteractionId`. For `priority_updated` / `completed` / `partial`, call the existing repo update.
  5. Patch the `VoiceInteraction` row with the final `actions` JSON (which now includes resolved task ids).
  6. Return `{ transcript, actions, recommendations }`.
- Ownership check via `canAccess` on each existing-task action; throw `NotFoundError` if Gemini referenced a task the user doesn't own.
- Atomicity: skipped for POC (per "ship small" feedback). Revisit if partial-failure cleanup becomes painful.

### 5.7 — Route + controller
- `src/controllers/voice.controller.ts` — receives multipart, pulls `req.file.buffer`, calls service.
- `src/routes/voice.routes.ts` — `POST /voice/process` with upload middleware.
- Mount in `src/routes/v1.ts`.

### 5.8 — Smoke test
- Curl with a real audio clip (user provides).
- Verify: transcript appears, actions execute (task created/updated in DB), recommendations array surfaces for fuzzy phrases, `VoiceInteraction` row persisted with non-null `actions`.
- Cleanup test: ghost-task-id action → backend returns 404 cleanly, doesn't half-commit other actions.

### 5.9 — `/simplify` pass on the new code
- Per [ADR-0019](../decisions/0019-deferred-tests.md), this is the quality gate.

## Acceptance Criteria

- `npm run typecheck` clean, `npm run lint` clean.
- Manual curl test with a real audio clip produces a valid response shape + persists `VoiceInteraction`.
- A misclassified or fuzzy phrase ends up in `recommendations`, not `actions` (recommendation pattern honored).
- No Prisma calls outside repositories. No Express types inside services or `src/lib/`.
- `taskRepo.listPending` (Sprint 4's Sprint-5 hook) is exercised by the context-loading step.

## Open questions deferred to "revisit if"

- Multimodal fusion (audio + image in one call) → Sprint 6 onward, per recorded discussion. Don't pre-build.
- Streaming response (server-sent events) for long transcripts → only if perceived latency becomes a problem.
- Caching the pending-tasks context → only if profile shows it's hot.
