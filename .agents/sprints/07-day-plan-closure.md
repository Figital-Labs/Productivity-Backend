---
id: SPRINT-07
title: Sprint 7 — Day Plan + Day Closure
status: in_progress
owner: claude-session
started: 2026-05-22
completed: null
tags: [sprint, ai, day-plan, day-closure, vertex]
related: [ARCHITECTURE, ADR-0001, ADR-0005, ADR-0011, SPRINT-05, SPRINT-06]
---

# Sprint 7 — Day Plan + Day Closure

## Goal

Close the product loop with the two endpoints that bind morning intent to evening reality:

- **`POST /day-plan/submit`** — Morning. Snapshot today's pending tasks as an immutable record of "what the user committed to."
- **`POST /day-closure/submit`** — Evening. User records voice commentary (and optional typed notes). Backend reuses the Sprint 5 voice flow to apply any task updates the user mentioned, then makes a **second Vertex call** to produce structured `aiFeedback` comparing plan vs. reality.

The voice flow's shared dispatcher ([action-dispatch.service.ts](../../src/services/action-dispatch.service.ts) — Sprint 6's extraction) gets its third caller via the closure endpoint. Per the "3+ callers agree" rule mentioned in Sprint 6's STATE notes, we'll reconsider the `VoiceAction` → `AiAction` rename at the end of this sprint.

## Storage status — still deferred

Per user decision 2026-05-22 (Sprint 7 questions): **GCS still pending, scope stays tight.**

Out of scope this sprint:
- `BlobStorage` interface + GCS impl
- `audioUrl` / `imageUrl` backfill on existing AI surfaces
- `POST /tasks/:id/media` attach + detach
- `POST /uploads` general endpoint
- Day-closure proof-of-work media (`mediaIds` parameter accepted but empty in practice)

Closure audio streams inline to Gemini and is not persisted, same as Sprint 5's voice flow. The blocker in STATE.md continues to track GCS readiness for a future sprint.

## Two product decisions baked in (POC simplifications — relax later)

1. **Day-closure requires a day-plan for the same date.** If the user tries to close out a day they never submitted a plan for, we return `409 NO_DAY_PLAN_FOR_DATE`. Rationale: the entire concept of "achievements vs missed vs partial" is meaningless without a baseline.
2. **One submit per (user, date) for both endpoints.** The Prisma schema already has `@@unique([userId, date])` on both submission tables. A second submit returns `409 ALREADY_SUBMITTED`. No edit/delete endpoints this sprint; if a user wants to "fix" a submission, they ask the dev to drop the row. (POC. Don't overbuild.)

## Sync points (where I pause for you)

1. **Before writing the day-closure feedback prompt** — show the prompt + structured-output schema. This is the highest-leverage decision in the sprint (second Vertex call, Hinglish output, six-field feedback).
2. **Before wiring controllers + routes** — same layered-shape check we've done in prior sprints.
3. **Smoke test** — you provide (or I generate) a closure audio clip. Day-plan submission is text-only so no clip needed for that half.

## Tasks

### 7.1 — Day plan: zod schemas + repository
- `src/schemas/day-plan.schema.ts` — `submitDayPlanInput` (optional `date`), `getDayPlanQuery` (required `date`).
- `src/repositories/day-plan.repository.ts` — `findByUserAndDate`, `create`. Json typing for `taskSnapshot`.

### 7.2 — Day plan: service + controller + route + mount
- `src/services/day-plan.service.ts`:
  - `submitDayPlan(user, { date? })` — resolves `date` (default today-in-user-tz), loads `taskRepo.listByDate(user.id, date)` (the day's visible tasks), snapshots into Json, throws `ConflictError("DAY_PLAN_ALREADY_SUBMITTED")` on duplicate.
  - `getDayPlan(user, date)` — returns `null` if not submitted.
- `src/controllers/day-plan.controller.ts` — `submit` (201) + `get` (200 or 404).
- `src/routes/day-plan.routes.ts` — `POST /submit`, `GET /`.
- Mount in `v1.ts` at `/api/v1/day-plan`.

### 7.3 — Day closure: AI feedback schema + prompt (sync point 1)
- `src/schemas/day-closure-feedback.schema.ts` — zod schema for the structured Vertex feedback:
  ```ts
  z.object({
    achievements: z.array(z.string()),  // tasks completed today
    missed:       z.array(z.string()),  // planned but not done
    partial:      z.array(z.string()),  // started but incomplete
    additions:    z.array(z.string()),  // ad-hoc work mentioned
    tips:         z.array(z.string()),  // suggestions for tomorrow
    summary:      z.string(),           // 1-2 sentence wrap-up
  })
  ```
- `src/lib/prompts/day-closure-feedback.ts` — Hinglish output, takes inputs: day-plan snapshot + current task states + closure narrative (transcript + typed commentary). Will show you before locking in.

### 7.4 — Day closure: input schema + repository
- `src/schemas/day-closure.schema.ts` — `submitDayClosureInput` (optional `commentary`, `date`, `mediaIds`). Audio comes via multipart, not in body — same pattern as voice.
- `src/repositories/day-closure.repository.ts` — `findByUserAndDate`, `create`.

### 7.5 — Day closure: orchestrator service
- `src/services/day-closure.service.ts`:
  1. Resolve date (default today). Require `DayPlanSubmission` exists; else `ConflictError("NO_DAY_PLAN_FOR_DATE")`.
  2. If duplicate closure: `ConflictError("DAY_CLOSURE_ALREADY_SUBMITTED")`.
  3. If audio provided → call `voiceIntentService.processVoice(user, audio)`. This executes any task updates the user mentioned (same dispatch path as Sprint 5) and returns `{ transcript, actions, recommendations }`.
  4. Build `closureNarrative` = `[typedCommentary, transcript].filter(Boolean).join("\n\n")`.
  5. Make the **second Vertex call** with `dayClosureFeedbackPrompt(planSnapshot, currentTaskStates, closureNarrative)` → structured `aiFeedback`.
  6. Persist `DayClosureSubmission` with everything.
  7. Return `{ transcript, taskUpdates: actions, recommendedNewTasks: recommendations, aiFeedback }`.

### 7.6 — Day closure: controller + route + mount
- `src/controllers/day-closure.controller.ts` — accepts multipart (audio field) + JSON body fields (commentary, date, mediaIds).
- `src/routes/day-closure.routes.ts` — `POST /submit` (with `voiceUpload.single("audio")` reused from Sprint 5), `GET /`.
- Mount in `v1.ts` at `/api/v1/day-closure`.

### 7.7 — Smoke test
- Seed 2-3 tasks for today via `POST /tasks` (with intentional priorities so day-plan has substance).
- `POST /day-plan/submit` → 201; verify `taskSnapshot` JSON.
- Generate SAPI TTS closure audio: *"I finished the buy bread task. The doctor appointment is partial — I called but they were closed. Also I went to the bank, that wasn't on my list."*
- `POST /day-closure/submit` → 201 with transcript, taskUpdates (1 completed + 1 partial), recommendedNewTasks (1: bank visit), aiFeedback structured into 6 fields.
- Verify DB: DayPlanSubmission row, DayClosureSubmission row, task state changes from the voice dispatch.
- Error paths: closure without plan (409), duplicate plan/closure (409), missing audio (400).

### 7.8 — `/simplify` checkpoint (your call)
- Skipped Sprints 4, 5. Ran into shared-dispatcher abstraction in Sprint 6 (didn't run simplify there). Sprint 7 is a good checkpoint — the third Vertex caller may surface real duplication patterns worth consolidating.

## Acceptance Criteria

- `npm run typecheck` clean, `npm run lint` clean.
- Day-plan and day-closure submissions persist to their respective tables.
- Day-closure correctly executes voice-driven task updates (uses Sprint 5's flow end-to-end).
- `aiFeedback` is returned in Hinglish and matches the 6-field schema.
- Error semantics: 409 for duplicate submission, 409 for closure-before-plan, 400 for validation issues.
- Existing voice + image flows still work (sanity check via typecheck — full smoke optional).

## Open questions deferred to "revisit if"

- **Closure without prior day-plan** — current rule: forbidden. If real users want EOD reflection without formal morning plan, relax to allow with empty snapshot baseline.
- **Editing a submitted plan/closure** — current rule: forbidden. No edit/delete endpoints. If demos demand it, add `PATCH /day-plan/:date` later.
- **Streaming the second Vertex call** — closure response could be 2x slower than Sprint 5 (two Vertex calls instead of one). Stream chunks via SSE if perceived latency hurts.
- **Caching day-plan reads** — POC has one user, no read traffic worth caching. Revisit when measured.
