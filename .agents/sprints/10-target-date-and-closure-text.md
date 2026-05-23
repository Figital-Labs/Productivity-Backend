---
id: SPRINT-10
title: Target-Date Action + Recommendation Hygiene + Closure Text-Only
status: ready-for-review
date: 2026-05-24
tags: [sprint, ai, schemas, prompts, closure]
related: [STATE, BUGS, SPRINTS-INDEX]
---

# Sprint 10 — Target-Date Action + Recommendation Hygiene + Closure Text-Only

## Goal

Three tightly-related backend changes that all surfaced in post-Sprint-09 smoke testing:

1. **`target_date_updated` action primitive.** The AI's vocabulary today (`created` / `priority_updated` / `completed` / `partial`) has no way to express "shift an existing task to a new date". So when the user says *"Monday ko baat karna hai"* about an existing task, the AI is forced into either (a) creating a duplicate or (b) emitting a `recommendation` — and the recommendation pathway is itself broken (see #2). Adds a fifth action variant + dispatcher case + prompt rule.

2. **Recommendation hygiene** — for the genuinely ambiguous cases that should *still* be recommendations. Today the AI puts question-shaped strings ("Shift X to Y?") into the `title` field, and the recommendation schema has no `targetDate`. So when the user taps ADD on the card, they get a task with a garbage title on today's date instead of the intended date. Tightens the schema (add optional `targetDate`) and the prompt (clean-title rule with explicit good/bad examples).

3. **`/day-closure/submit` audio-optional.** EOD multi-recording fix on the frontend (BUG-B) requires the per-recording voice processing to use `/voice/process`, and the final EOD submit to ship text only. Backend changes: drop the `req.file` requirement, skip the voice-intent step when audio is absent, generate `aiFeedback` from commentary alone.

Owner: claude-session. Estimate: ~1.5 hours.

---

## Background — what user saw

Concrete failure observed (2026-05-24):

User input "Sneha se baat karna hai - Monday ko karna hai" via text dictation, with an existing task titled "Sneha se baat karna hai" on today (2026-05-24).

**Observed cascade:**
1. AI identified the existing task by title and resolved Monday = 2026-05-25 ✅
2. But emitted as a `recommendation`, not an action ❌ (no `target_date_updated` exists in schema)
3. Recommendation `title` field was the prompt-question *"Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"* ❌
4. Recommendation had no `targetDate` field (schema lacks it) ❌
5. User tapped `+ ADD` → frontend created new task with that question-string as title, on today's `viewDate` ❌
6. Result: original task untouched on today, plus a new garbage-titled task also on today. Both wrong.

The action primitive fix solves #2 for the **clear** case (your scenario should never reach the recommendation pathway after this sprint). The recommendation hygiene fix solves #3 + #4 + #5 for **ambiguous** cases that should remain recommendations.

---

## Tasks

### 10.1 — `target_date_updated` action variant

**Files:**

- `src/schemas/voice-intent.schema.ts` — add 5th variant to `voiceActionSchema`:
  ```ts
  z.object({
    type: z.literal("target_date_updated"),
    taskId: z.string().min(1),
    targetDate: ymdDateSchema,     // REQUIRED — the whole point of the action
    reasoning: z.string(),
  })
  ```
- `src/schemas/text-process.schema.ts` — no change needed (re-uses `voiceActionSchema`).
- `src/schemas/image-extraction.schema.ts` — no change needed (re-exports `voiceActionSchema`).
- `src/schemas/unified-intent.schema.ts` — add the 5th variant with `source: sourceModalityEnum`.
- `src/services/action-dispatch.service.ts`:
  - Extend `PersistedAiAction` union with the new variant.
  - Add `case "target_date_updated"` in the switch: `await taskService.getTask(user, action.taskId)` (auth + 404), then `await taskRepo.update(action.taskId, { targetDate: parseDateString(action.targetDate) })`. Return `{ type, taskId, targetDate, reasoning }`.

### 10.1.b — Recommendation hygiene (schemas)

**Files:**

- `src/schemas/voice-intent.schema.ts` — add `targetDate: ymdDateSchema.optional()` to `voiceRecommendationSchema`.
- `src/schemas/unified-intent.schema.ts` — add same field to `unifiedRecommendationSchema`.
- text + image reuse voice's recommendation schema, so no change needed there.

### 10.2 — Prompt updates (all 4 prompts)

For each of:
- `src/lib/prompts/voice-intent.ts`
- `src/lib/prompts/text-intent.ts`
- `src/lib/prompts/image-extraction.ts`
- `src/lib/prompts/unified-intent.ts`

**(a) Extend INTENT TYPES** section: add the 5th type.

```
"target_date_updated" — user wants to MOVE an existing task to a different date
                        (not create a duplicate, not mark it done)
```

**(b) Insert a new RULE — TARGET DATE UPDATE** — positioned right after the existing-task-matching rule:

```
TARGET DATE UPDATE — for existing tasks moving to a new date

When the user's input clearly references an EXISTING pending task (matched by title from
CONTEXT.tasks) AND clearly specifies a new date (relative or absolute), emit a
`target_date_updated` action — do NOT create a duplicate, do NOT emit a recommendation.

  ✓ Input: "Sneha se baat karna hai - Monday ko karna hai" + existing task "Sneha se baat karna hai"
    → target_date_updated { taskId: <existing>, targetDate: "<resolved Monday>" }
  ✓ Input: "Friday ko ward 12 visit shift kar do" + existing task "Ward 12 visit"
    → target_date_updated { taskId: <existing>, targetDate: "<upcoming Friday>" }
  ✓ Input: "Move the report submission to parso" + existing task "Submit report"
    → target_date_updated { taskId: <existing>, targetDate: "<parso>" }

When NOT to use target_date_updated:
  - User says a date but NO existing task matches → use `created` with `targetDate`.
  - User says ambiguously which task ("us wale ko shift karo" with multiple candidates) → recommendation.
  - User says "create a new one for Monday too" (explicit duplicate intent) → use `created`.

Use the same TODAY + Hinglish-tense rules above to resolve the date.
```

**(c) Insert a new RULE — RECOMMENDATION TITLE FORMAT** — positioned near the recommendation-routing rules:

```
RECOMMENDATION TITLE FORMAT
The `title` field on a recommendation is what the task will be CALLED when the user taps ADD.
It MUST be a clean, declarative task name — NOT a question, NOT a "Shift X to Y?" prompt,
NOT a sentence with quoted strings inside it.

  ✓ "Sneha se baat karna hai"
  ✓ "Submit quarterly report"
  ✓ "Ward 12 round (Monday)"
  ✗ "Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"
  ✗ "Did you mean to create a new task for X?"
  ✗ "Add task: Sneha se baat karna hai"

The question/explanation belongs in the `reasoning` field. The `title` is the title.
```

**(d) Note the optional `targetDate` on recommendations** — small line in the recommendation section saying: "When the recommendation implies a specific date (e.g., user said 'Monday' but the match is ambiguous), include the resolved `targetDate` so the frontend can land the task on that date when the user taps ADD."

### 10.3 — Day Closure: audio becomes optional

**Files:**

- `src/controllers/day-closure.controller.ts`:
  - Drop the `if (!req.file) throw ValidationError(...)` check.
  - Parse body first. After parse: require `input.commentary?.trim().length > 0` when `req.file` is absent — throw `ValidationError("Either audio or commentary is required")`.
  - Pass `req.file ? { buffer, mimeType } : undefined` to the service.
- `src/services/day-closure.service.ts`:
  - Change `audio` param to `DayClosureAudioInput | undefined`.
  - When absent: skip the `voiceIntentService.processVoice` call entirely; treat voiceResult as `{ transcript: "", actions: [], recommendations: [] }`.
  - Downstream code already supports text-only closureNarrative via the existing filter; nothing else changes.

No schema change needed — `commentary` is already optional in the body schema; the "audio OR commentary required" invariant is enforced at the controller boundary as a precondition.

---

## Acceptance Criteria

1. `npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅.
2. All 4 schemas + dispatcher + 4 prompts updated.
3. Smoke tests pass (below).
4. BUGS.md gets BUG-A (target-date-shift) entry with ✅ fixed.
5. STATE.md changelog updated; sprint status table reflects Sprint 10.

---

## Smoke tests

1. **Date-shift via text** — `curl POST /text/process` with body `{"text": "Sneha se baat karna hai - Monday ko karna hai"}`, no targetDate.
   - Pre-seed: create task "Sneha se baat karna hai" on today.
   - Expect: response has `actions: [{ type: "target_date_updated", taskId: <existing>, targetDate: "2026-05-25", ... }]`, no recommendation for the date-shift case.
   - Verify: `GET /tasks?date=2026-05-25` lists the task; `GET /tasks?date=2026-05-24` (today) does NOT list it.
   - Verify: `GET /tasks/<id>` returns same id with updated `targetDate`. No new row created.
2. **Ambiguous reference falls back to clean recommendation** — `POST /text/process` with body `{"text": "us wale ko Monday shift karo"}` and 2+ similarly-titled tasks.
   - Expect: empty `actions[]`; one recommendation with clean noun-phrase title (NOT "Shift X to Y?") and populated `targetDate`.
3. **Created with targetDate (regression)** — `POST /text/process` with body `{"text": "kal ward 12 visit"}`, no matching task.
   - Expect: response has one `created` action with `targetDate: 2026-05-25`. Existing Sprint 8 behavior preserved.
4. **EOD text-only submit** — `curl POST /day-closure/submit` with `commentary=...` form field, NO file.
   - Expect: 201 with `taskUpdates: []`, valid `aiFeedback` populated from commentary alone.
5. **EOD missing both** — `POST /day-closure/submit` with no file AND no commentary.
   - Expect: 400 with `VALIDATION_ERROR` and a clear message.
6. **EOD with audio (regression)** — submit with both file + commentary.
   - Expect: existing behavior preserved (voice intent runs, transcript appears, AI feedback uses both).

---

## Out of scope

- Frontend changes (separate FE Sprint 10).
- BUG-011 (Day Closure on future dates) — handled FE-side.
- CONSIDER-002 (forward nav cap) — deferred per user.
- Backend tests (vitest).
- `priority_updated` doesn't gain a `recommendation` equivalent — out of scope; date is the bug we're fixing.

---

## Handoff to FE Sprint 10

After this lands:
- FE 10 picks up the new `target_date_updated` variant in `BackendVoiceAction` DTO.
- FE 10 picks up the optional `targetDate` on recommendation payloads.
- FE 10 changes EOD modal to call `/voice/process` per-recording + EOD submit becomes text-only.
- FE 10 must verify smoke case #2 from BE smoke continues to hold end-to-end (recommendation ADD lands on the AI's date).
