---
id: SPRINT-17-BE
title: "Sprint 17 (BE) — Two-Phase Day Closure: Review → Submit + Transcription"
status: ready-for-review
owner: claude-session
estimate: ~1 day
depends_on: [Sprint 7 (day-closure), Sprint 16B (dashboard reads DayClosureSubmission)]
paired_with: Task-List/.agents/sprints/17-closure-review-flow.md
date: 2026-05-27
---

# Sprint 17 (BE) — Two-Phase Day Closure

## Mission

Today's `POST /day-closure/submit` is a **single shot**: it runs the AI feedback call AND freezes the closure in the same request. The founder's actual mental model is a **two-phase loop**:

> Staff works the day → clicks **Review** → AI tells them what they did vs. missed (a coaching mirror, *not* a submission) → staff records/writes **excuses** for the misses → staff clicks **final Submit** to freeze it.

This sprint splits closure into **Review** (AI runs once, persists a draft) and **Submit** (finalize), and adds a reusable **transcription** endpoint so excuse-voice becomes plain text instead of mutating tasks.

This is also a **behavior change**, called out loudly so nobody trips on it:

> 🔴 **Closure no longer flips task states from voice.** Today, EOD voice clips run through `/voice/process` and mark tasks done/partial. After this sprint, task states are set **manually by the user** (the existing inline pills), and closure voice is **excuse commentary only** — transcribed to text, never dispatched as task actions. `/voice/process` itself is untouched; only the closure flow stops calling it.

---

## Required reading (in this order)

1. This file.
2. Current closure service: [src/services/day-closure.service.ts](../../src/services/day-closure.service.ts) — the single-shot flow you are splitting.
3. Current feedback prompt: [src/lib/prompts/day-closure-feedback.ts](../../src/lib/prompts/day-closure-feedback.ts) — reused **verbatim** by the Review phase. The AI semantics don't change; only *when* it runs does.
4. Schema + repo: [src/schemas/day-closure.schema.ts](../../src/schemas/day-closure.schema.ts), [src/repositories/day-closure.repository.ts](../../src/repositories/day-closure.repository.ts).
5. **Cross-impact — read carefully:** [src/services/dashboard-rollup.service.ts](../../src/services/dashboard-rollup.service.ts) and [src/services/activity.service.ts](../../src/services/activity.service.ts). Sprint 16B counts `DayClosureSubmission` rows as "closures submitted." Once draft rows exist, **every count must filter `status: "submitted"`** or drafts will inflate the dashboard. See Phase 5.
6. Vertex helper: [src/lib/vertex.ts](../../src/lib/vertex.ts) — only `generateStructured` exists today; you'll add a plain-text helper for transcription (Phase 4).
7. The original founder intent (Section 2): [FOUNDER_EYE_GOTCHAS.md](../../../FOUNDER_EYE_GOTCHAS.md) — this sprint closes the "pre-submit AI enrichment" gotcha.

---

## Locked decisions (this planning round)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Two-phase flow.** `POST /day-closure/review` (AI once → draft) + `POST /day-closure/submit` (finalize). | Founder's review-then-submit loop. |
| D2 | **Data model: `status` column on `DayClosureSubmission`.** Add `status: 'draft' \| 'submitted'` (default `'submitted'`) + `reviewedAt DateTime?`. One additive migration; existing rows become `status='submitted'`, which is correct. | Respects existing `@@unique([userId, date])`; one row per (user, date) transitions draft→submitted. |
| D3 | **Tasks stay editable until final submit.** The AI review is a point-in-time snapshot and **may be stale** at submit time (user edits a task after reviewing). Accepted for POC. | User chose "tasks editable until submit." |
| D4 | **Closure voice = excuse/justification only.** No task-state mutation in the closure flow. | User chose "pure justifications." |
| D5 | **New `POST /transcribe`** (multipart audio → `{ transcript }`). No side effects, no `VoiceInteraction` row, no task dispatch. | Audio-as-proof gets transcribed to text (S3 still deferred — we don't store the audio). |
| D6 | **AI runs ONCE.** Calling Review again on an existing draft returns the **stored** review without regenerating. Explicit "re-run review" is deferred — leave a clean seam (a documented `force` path you don't wire yet). | User: "it runs once, and it should run once." |
| D7 | **Closure still requires a prior day-plan** (keep `409 NO_DAY_PLAN_FOR_DATE`). | Unchanged Sprint 7 rule. |
| D8 | **Personal-flow prompts untouched.** `voice-intent.ts` / `text-intent.ts` / `image-extraction.ts` / `unified-intent.ts` and `/voice/process` are byte-identical. Only the closure flow stops calling `processVoice`. | Standing scope guarantee. |

---

## Scope

### In scope
- Schema: `status` + `reviewedAt` on `DayClosureSubmission` + migration.
- `POST /day-closure/review` (new).
- `POST /day-closure/submit` (rewrite — no audio, no voice processing, requires a prior draft).
- `POST /transcribe` (new, reusable).
- **Filter all submitted-closure reads to `status='submitted'`** across dashboard + activity (Phase 5).

### Out of scope
- Day **plan** stays single-shot submit. No two-phase for plans.
- Re-run-review button (D6 — seam only).
- S3 / audio persistence (still deferred).
- Any change to `/voice/process`, `/text/process`, `/images/process`, `/process`.
- FE work (paired sprint).

---

## Phases

### Phase 1 — Schema migration
[prisma/schema.prisma](../../prisma/schema.prisma) — extend `DayClosureSubmission`:

```prisma
model DayClosureSubmission {
  id          String    @id @default(cuid())
  userId      String
  date        DateTime  @db.Date
  status      String    @default("submitted")  // 'draft' | 'submitted'
  reviewedAt  DateTime?                          // set when AI review runs
  submittedAt DateTime  @default(now())          // set/updated at final submit
  commentary  String
  aiFeedback  Json                               // the AI review payload
  mediaIds    String[]

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, date])
}
```

One migration: `ALTER TABLE` add `status` (default `'submitted'`) + `reviewedAt` (nullable). Existing rows correctly become submitted. No data backfill needed.

> Note `aiFeedback` stays `Json` (non-null). A draft created at Review time always has the AI payload, so it's never null. Keep it required.

### Phase 2 — Review endpoint
Files: [src/services/day-closure.service.ts](../../src/services/day-closure.service.ts), controller, route, schema.

`POST /day-closure/review` — body `{ date? }` (defaults to today IST).

Service `reviewDayClosure(user, { date })`:
1. Validate plan exists for the date → else `409 NO_DAY_PLAN_FOR_DATE`.
2. `findByUserAndDate(user.id, date)` (returns any row — draft or submitted):
   - `status === 'submitted'` → `409 DAY_CLOSURE_ALREADY_SUBMITTED`.
   - `status === 'draft'` (has `reviewedAt`) → **return the stored review unchanged** (D6 — runs once). Do NOT call Vertex again.
   - none → run AI:
     - load current task states (`taskRepo.listByDate`), build prompt via `buildDayClosureFeedbackPrompt` (closureNarrative = `""` at review time — no commentary yet).
     - `generateStructured` → `aiFeedback`.
     - create row: `status='draft'`, `aiFeedback`, `reviewedAt=now`, `commentary=''`, `mediaIds=[]`.
3. Return `{ dayClosureId, status, reviewedAt, aiFeedback }`.

Repo: add `createDraft(...)` (or reuse `create` with the new fields) and keep `findByUserAndDate` finding *any* status (Review/Submit need to see drafts).

### Phase 3 — Submit endpoint (rewrite)
`POST /day-closure/submit` — body `{ date?, commentary? }`. **No multipart, no `req.file`.**

Service `submitDayClosure(user, { date, commentary })`:
1. `findByUserAndDate(user.id, date)`:
   - none → `400 DAY_CLOSURE_REVIEW_REQUIRED` ("Run review before submitting.").
   - `status === 'submitted'` → `409 DAY_CLOSURE_ALREADY_SUBMITTED`.
   - `status === 'draft'` → update row: `status='submitted'`, `commentary=commentary ?? ''`, `submittedAt=now`. Leave `aiFeedback` as-is (the review from Phase 2).
2. Return the finalized closure.

**Delete** from the service: the `audio` param, `voiceIntentService.processVoice` call, the `DayClosureAudioInput`/`DayClosureSubmitResult` voice fields. Controller drops `req.file` handling and the multer middleware on the route. The submit response shape changes — coordinate with the FE sprint (it expects the finalized `DayClosureSubmission`, not the old `{ transcript, taskUpdates, ... }`).

Repo: add `markSubmitted(id, { commentary })` or a generic `update`.

### Phase 4 — Transcription endpoint
New files:
- [src/lib/vertex.ts](../../src/lib/vertex.ts) — add `generateText({ model, prompt, media })` returning a plain string (mirror `generateStructured` but no `responseJsonSchema`; throw `UpstreamError("AI_EMPTY_RESPONSE")` on empty). Reuse the same `GeminiPart`/`InlineMedia` plumbing.
- `src/lib/prompts/transcribe.ts` — verbatim-transcription prompt. **Must enforce the standing language rule: output in Hinglish/English Roman script, NEVER Devanagari, even if the audio is Hindi.** Transcribe faithfully; do not summarize, translate, or add commentary.
- `src/services/transcription.service.ts` — `transcribeAudio({ buffer, mimeType }) → { transcript }`. No DB write.
- `src/controllers/transcription.controller.ts` + `src/routes/transcribe.routes.ts` — `POST /transcribe`, `jwtAuth` only (no role gate), `voiceUpload.single("audio")` (reuse the existing 10 MB audio multer preset), `400` if no audio. Mount in [src/routes/v1.ts](../../src/routes/v1.ts) at `/transcribe`.

### Phase 5 — Submitted-only read filter (CRITICAL cross-impact — DO NOT SKIP)

> 🔴 **This phase is a hard gate, not an optional cleanup.** The Review phase (Phase 2) creates a `DayClosureSubmission` row with `status='draft'` **before** the user has actually finalized anything. Every Sprint-16B query that counts/lists closures treats *any* row as "submitted." If you don't add `status: "submitted"` at each read site, a staff member who merely *opens* Review will instantly count as "closure submitted" on the manager dashboard — the dashboard will lie. Sprint 17 is **not done** until every box below is checked.

**The rule:** a draft row means "in progress, not finalized." Only `status='submitted'` rows are real closures.

Add `status: "submitted"` to the `where` clause at **every one of these sites** (line numbers are approximate — grep to confirm):

- [ ] [src/services/dashboard-rollup.service.ts](../../src/services/dashboard-rollup.service.ts) → `kpisForUsers` — the `prisma.dayClosureSubmission.count({ where: { userId: { in }, date: targetDate } })` (~L146).
- [ ] same file → `kpisForUsersInRange` — `dayClosureSubmission.count({ ... date: today })` (~L180).
- [ ] same file → `trendForUsers` — the closures branch `return prisma.dayClosureSubmission.count({ ... date })` (~L225).
- [ ] same file → `consistencyForUsers` — the closures `findMany({ ... date: { in: dates } })` (~L258). A draft day is still a **missed** closure until finalized — this is what powers People-to-Watch.
- [ ] [src/repositories/day-closure.repository.ts](../../src/repositories/day-closure.repository.ts) → `listSubmittedInRange` (feeds the activity feed, ~L28).
- [ ] same file → `listForUsersInDateRange` (feeds consistency + the unreviewed-count badge, ~L53).
- [ ] [src/services/activity.service.ts](../../src/services/activity.service.ts) → the `dayClosureSubmission.findMany` projection (the `day_closure_submitted` event).
- [ ] `listUnreviewedClosures` (in day-closure.service.ts) + the `SubmissionReview` badge path — auto-covered once `listForUsersInDateRange` filters, but verify a draft never appears in a manager's "unreviewed" list.

**Leave these two UNFILTERED on purpose** (they must see drafts):
- `findByUserAndDate` — Review and Submit use it to find an existing draft to read/finalize.
- `getDayClosure` (the `GET /day-closure?date=` the FE resumes from) — the FE needs the draft back to rehydrate the review screen.

**Verification grep (run before declaring done):**
```
grep -rn "dayClosureSubmission" src/
```
Every hit must be classified: either it carries `status: "submitted"` (a "real closure" read) OR it's one of the two intentional unfiltered sites above. No unclassified hit may remain. Add this grep result to the handoff notes.

---

## Acceptance criteria
- `POST /day-closure/review` on a date with a plan → `201`, `status:'draft'`, populated Hinglish `aiFeedback`.
- Re-calling review on the same date returns the **same** `aiFeedback` and **unchanged** `reviewedAt` (no second Vertex call — verify via timestamp).
- `POST /day-closure/submit` after a review → `200`, `status:'submitted'`, `commentary` persisted.
- Submit without a prior draft → `400 DAY_CLOSURE_REVIEW_REQUIRED`.
- Submit/Review on an already-submitted date → `409 DAY_CLOSURE_ALREADY_SUBMITTED`.
- Review with no plan → `409 NO_DAY_PLAN_FOR_DATE`.
- `POST /transcribe` with audio → `200 { transcript }` in Roman script (no Devanagari); no `VoiceInteraction` row created; no task mutated.
- `GET /day-closure?date=` returns a draft row (so the FE can resume) including `status` + `reviewedAt`.
- **Regression:** closure flow never flips a task state. A task left `pending` stays `pending` through review+submit.
- **Dashboard regression:** a draft closure does NOT increment "closures submitted" on `/dashboard/overview` or `/dashboard/consistency`; only a finalized one does.
- `npm run typecheck && npm run lint && npm run build` clean.

## Smoke matrix (curl against live dev server, kims-hospital seed)
1. Login sneha → submit a plan for today (if not seeded) → `POST /day-closure/review` → 201 draft + feedback.
2. Re-POST review → same payload, same `reviewedAt`.
3. `GET /day-closure?date=today` → row with `status:'draft'`.
4. `POST /day-closure/submit { commentary:"Ward round late tha staff shortage ki wajah se" }` → 200 submitted.
5. `POST /day-closure/submit` again → 409 ALREADY_SUBMITTED.
6. Fresh date, `POST /day-closure/submit` with no prior review → 400 REVIEW_REQUIRED.
7. Date with no plan → review → 409 NO_DAY_PLAN_FOR_DATE.
8. `POST /transcribe` with a TTS wav ("kal report submit kar dunga") → 200, transcript in Roman, no Devanagari.
9. `POST /transcribe` with a non-audio file → 400.
10. As sharma, `GET /dashboard/overview` before submit (sneha draft exists) → closuresSubmittedToday does NOT include sneha; after submit → it does.
11. `GET /dashboard/consistency?days=7` — a draft day still shows as a missed closure for that day.

## Failure modes to guard
- **FM1 — Draft counted as submitted.** The whole point of Phase 5. If skipped, the dashboard lies. Grep for every `dayClosureSubmission` read before declaring done.
- **FM2 — Stale review confusion.** Tasks editable after review (D3) means `aiFeedback` can disagree with final task states. Accepted, but store `reviewedAt` so the FE can show "reviewed at HH:MM" and the manager has context. Do NOT silently regenerate.
- **FM3 — Submit response shape change.** The old `{ transcript, taskUpdates, recommendedNewTasks, aiFeedback }` is gone. The FE sprint must land together or the closure tab breaks. Flag in handoff.
- **FM4 — Transcribe hallucinating tasks.** The transcribe prompt must ONLY transcribe — no summarizing, no "action items." Keep it dumb.
- **FM5 — Devanagari leak in transcript.** Enforce the Roman-script rule in the transcribe prompt like every other AI surface.

## Handoff state (fill on completion)
- [x] Migration name + applied — `prisma/migrations/20260527120000_sprint17_closure_two_phase/migration.sql` applied to local Postgres `tasklist` via `npx prisma migrate deploy`. Adds `status TEXT NOT NULL DEFAULT 'submitted'` and `reviewedAt TIMESTAMP(3)` to `DayClosureSubmission`. Existing rows default to `'submitted'` (correct: they were created by the pre-Sprint-17 single-shot flow).
- [x] Endpoints live:
  - `POST /api/v1/day-closure/review` — body `{ date? }` → `201 { dayClosureId, status:'draft', reviewedAt, aiFeedback }`. Idempotent on existing draft (D6).
  - `POST /api/v1/day-closure/submit` — body `{ date?, commentary? }` → `200 DayClosureSubmission` with `status:'submitted'`. **No multipart, no audio param.** Requires a prior draft → `400 DAY_CLOSURE_REVIEW_REQUIRED` otherwise.
  - `POST /api/v1/transcribe` — multipart `audio` field (10 MB cap, same MIME whitelist as `/voice/process`) → `200 { transcript }`. Roman-script only. `jwtAuth` only, no role gate. No DB write.
- [x] Phase 5 read-filter audit — `Select-String src\**\*.ts dayClosureSubmission` (PowerShell equivalent of the grep) classification:
  - **Filtered (status='submitted')**:
    - `src/repositories/day-closure.repository.ts` L70-71 (`listSubmittedInRange`) — activity feed source
    - `src/repositories/day-closure.repository.ts` L101-103 (`listForUsersInDateRange`) — feeds `listUnreviewedClosures` + consistency reads
    - `src/services/dashboard-rollup.service.ts` L148 (`kpisForUsers`)
    - `src/services/dashboard-rollup.service.ts` L183 (`kpisForUsersInRange`)
    - `src/services/dashboard-rollup.service.ts` L237 (`trendForUsers` closures branch)
    - `src/services/dashboard-rollup.service.ts` L279 (`consistencyForUsers`) — drafts remain "missed" until finalized
    - `src/services/activity.service.ts` L295 (activity feed `findMany`)
    - `src/services/team.service.ts` L102 (`listReports` closure-badge flag)
    - `src/services/team.service.ts` L151 (`getReportSubmissions` — explicit `dayClosureRow?.status === 'submitted' ? dayClosureRow : null` so a draft doesn't surface to the manager drill-down)
  - **Intentionally unfiltered (must see drafts)**:
    - `src/repositories/day-closure.repository.ts` L27-34 (`findByUserAndDate`) — review/submit/get need to find a draft
    - `src/repositories/day-closure.repository.ts` L50-51 (`createDraft`) — write site
    - `src/repositories/day-closure.repository.ts` L88-89 (`markSubmitted`) — write site (transitions draft → submitted)
    - `src/services/day-closure.service.ts` L132 (`submitDayClosure` reads draft to finalize)
    - `src/services/day-closure.service.ts` L157 (`getDayClosure` resume path — FE rehydrates the review screen)
    - `src/services/day-closure.service.ts` L172 (`listUnreviewedClosures` calls `listForUsersInDateRange` which IS filtered — auto-covered)
  - Comment-only hit: `src/schemas/day-closure-feedback.schema.ts` L5 (JSDoc reference only).
- [x] Submit response shape documented for the FE:
  - **Old (Sprint 7–10)**: `{ dayClosureId, transcript, taskUpdates, recommendedNewTasks, aiFeedback }` — gone.
  - **New (Sprint 17 `/submit`)**: the bare `DayClosureSubmission` row → `{ id, userId, date, status:'submitted', reviewedAt, submittedAt, commentary, aiFeedback, mediaIds }`. The AI payload is already on screen from the Review phase; submit only confirms persistence.
  - **New (Sprint 17 `/review`)**: `{ dayClosureId, status:'draft', reviewedAt, aiFeedback }` — the minimal shape the FE needs to render the review screen.
  - **`GET /day-closure?date=`** still returns the full `DayClosureSubmission` row, now including `status` + `reviewedAt`, and will return a draft if one exists (Phase 5 intentional-unfiltered) so the FE can resume.
  - **Error codes**: `DAY_CLOSURE_REVIEW_REQUIRED` (400, new), `DAY_CLOSURE_ALREADY_SUBMITTED` (409, existing), `NO_DAY_PLAN_FOR_DATE` (409, existing on `/review`).
- [ ] Smoke matrix results — **pending live curl run by user**. Postman collection updated with three new requests: "Review Day Closure", "Submit Day Closure" (rewritten, JSON body), "Transcribe Audio". The old "Submit Day Closure With Audio" request was replaced — drop it from any saved environments.
- [x] STATE.md changelog entry — Sprint 17 row added to status table; "Active Sprint" section now leads with Sprint 17.
