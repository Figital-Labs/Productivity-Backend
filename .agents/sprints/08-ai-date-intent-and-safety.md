---
id: SPRINT-08
title: Sprint 8 — AI Date Intent + Context Enrichment + Safety Caps
status: checkpoint
owner: claude-session
started: 2026-05-23
completed: 2026-05-23
date: 2026-05-23
tags: [sprint, ai, date, prompts, schemas, safety, sort]
related: [STATE, SPRINTS-INDEX, SPRINT-05, SPRINT-06, SPRINT-07, BUGS-FRONTEND]
---

# Sprint 8 — AI Date Intent + Context Enrichment + Safety Caps

## Why this exists

Six backend follow-ups surfaced from frontend smoke-testing (see [Task-List/.agents/BUGS.md](../../../Task-List/.agents/BUGS.md), bugs 002 / 003 / 004 / 006 / 009 / CONSIDER-001). They all sit in the AI processing / dispatcher / repository surface, so doing them as one sprint avoids three separate prompt-retest cycles and three separate "did I break the structured-output schema?" reviews.

The six concerns:

1. **AI is time-blind** ([BUG-006](../../../Task-List/.agents/BUGS.md)). None of the four prompts (voice / text / image / unified) tell Gemini what today's date is. Relative-date phrases like *"kal muje ward 12 me jaana hai"* silently land on today instead of tomorrow because (a) the AI can't resolve "kal", and (b) even if it could, the `created` action schema has no `targetDate` slot for it to communicate the intent.
2. **Frontend can't override target date** ([BUG-002](../../../Task-List/.agents/BUGS.md), backend half). The frontend doesn't pass the user's selected `viewDate` to `/text/process`, `/voice/process`, `/images/process`. Even if it did, the schemas wouldn't accept it. Result: when the user navigates to "Monday" in Day Plan and dictates tasks, they land on today's date instead of Monday.
3. **AI reasoning is meta-debug + wrong language** ([BUG-003](../../../Task-List/.agents/BUGS.md)). User direction updated 2026-05-23: reasoning STAYS visible to users (it's valuable when phrased well), but today it reads like classifier-debug output referencing internal rule numbering, and ignores the user's input language. Prompt rewrite required: brief (≤ 20 words), conversational P.A. tone, and language match (English in → English out; Hinglish in → Hinglish out).
4. **Notes excluded from AI context** ([CONSIDER-001](../../../Task-List/.agents/BUGS.md)). The pending-tasks context sends `{id, title, priority, targetDate}` per task. Notes are skipped. When two tasks have similar titles (e.g., two "Patient rounds" with notes distinguishing wards), the AI can't disambiguate. Hospital workflow specifically benefits from notes.
5. **No file size guards** ([BUG-009](../../../Task-List/.agents/BUGS.md), backend half). Multer has no `limits.fileSize` on `/voice/process` or `/images/process`. A 50 MB phone photo or a 10-minute audio dump can 500 the backend or hang Gemini.
6. **Task list default sort is wrong** ([BUG-004](../../../Task-List/.agents/BUGS.md)). `task.repository.ts.listByDate` sorts by `[priority asc, createdAt asc]`. User wants recently-touched tasks to float to top — i.e., `updatedAt desc`.

## Goal

- AI prompts include today's date and tense-disambiguation rules. Gemini resolves "kal" / "tomorrow" / "Friday" / etc. against an anchored date.
- `created` action schemas accept an optional `targetDate: YYYY-MM-DD`. Dispatcher honors it; falls back to `today` when omitted.
- All four AI input schemas (text / voice / image / unified) accept an optional `targetDate` from the client. When present, that's the value passed to the prompt as "today" AND to the dispatcher as the default target date.
- Pending-tasks AI context includes notes, truncated to ~200 chars.
- Multer rejects oversized uploads on `/voice/process` and `/images/process` with `413`.
- `listByDate` and `listOpenCarryOver` sort by `updatedAt desc`.

## Out of scope (intentionally)

- Anything frontend ([Task-List/.agents/sprints/07-date-and-acknowledgement.md](../../../Task-List/.agents/sprints/07-date-and-acknowledgement.md) and [08-modal-polish.md](../../../Task-List/.agents/sprints/08-modal-polish.md) own the frontend halves of BUG-002 and BUG-009).
- BUG-001 (date nav skip Sundays), BUG-003 (hide AI reasoning), BUG-005 (acknowledgement summary), BUG-007 (discard confirm), BUG-008 (audio playback), BUG-010 (Edit modal status pills) — all frontend-only, not this sprint.
- Database migrations. `Task` already has `updatedAt` (Prisma `@updatedAt`) and there's no new column needed.
- New endpoints. Everything is additive to existing endpoints.
- Removing the existing `actions[].targetDate` fallback behavior (created tasks still default to today when neither the request nor the AI specifies a date).

## Backwards compatibility

This sprint is **fully backwards-compatible** with the current frontend.

- `targetDate` on AI input schemas is **optional**. Frontend that doesn't send it gets today (current behavior).
- `targetDate` on AI output (`created` actions) is **optional**. AI that doesn't return it (e.g., short-prompt models or fallback paths) gets today via the dispatcher's `??` fallback.
- Notes in context is additive — old tasks without notes pass `undefined`, which gets dropped from the JSON.
- File size limits return a clear 413 error; the frontend can handle it gracefully when it ships its own caps (BUG-009 frontend half in [FE Sprint 08](../../../Task-List/.agents/sprints/08-modal-polish.md)).
- Sort order change is invisible at the API layer (same response shape, just reordered).

This means **Backend Sprint 08 can ship to production before either frontend sprint lands.** No coordinated rollout needed.

## Backend Contract Changes

### Input schema additions

For all four AI endpoints (`POST /text/process`, `POST /voice/process`, `POST /images/process`, `POST /unified/process`):

```ts
{
  // existing fields stay
  targetDate?: string  // YYYY-MM-DD; optional; backend defaults to today-in-IST when omitted
}
```

For voice + image (multipart): `targetDate` is a form field alongside the file.
For text + unified (JSON): `targetDate` is a top-level body property.

### Output schema additions

The `created` variant in the AI response (and the `PersistedAiAction.created` shape returned to the client) gains:

```ts
{
  type: "created",
  title: string,
  notes?: string,
  priority?: "low" | "medium" | "high",
  targetDate?: string,   // YYYY-MM-DD; populated when AI extracted a relative-date phrase from user input
  reasoning: string,
}
```

The other three variants (`priority_updated`, `completed`, `partial`) are unchanged — they operate on existing tasks, so no `targetDate` needed.

### Error code additions

- `FILE_TOO_LARGE` — multer-rejected upload. 413. Message includes the actual cap (e.g., "Audio file must be ≤ 10 MB").

## Files In Scope

- `.agents/STATE.md` — append Sprint 08 changelog entry, flip the Sprint 08 row when checkpointed.
- `.agents/sprints/README.md` — Sprint 08 status row.
- `.agents/sprints/08-ai-date-intent-and-safety.md` — this file. Status `scoped` → `in_progress` → `checkpoint`.
- `src/schemas/text-process.schema.ts` — add optional `targetDate`.
- `src/schemas/voice-intent.schema.ts` — add optional `targetDate` to input + add optional `targetDate` to the `created` action shape.
- `src/schemas/image-process.schema.ts` (or wherever image input is validated) — add optional `targetDate` to input + `created` action.
- `src/schemas/unified-process.schema.ts` — same.
- `src/schemas/day-closure.schema.ts` — **out of scope** (closure is per-date already, no relative-date input from AI).
- `src/lib/prompts/voice-intent.ts` — add TODAY'S DATE section + Hinglish tense rules + targetDate rule. Extend `PendingTaskContext` with `notes`.
- `src/lib/prompts/text-intent.ts` — same.
- `src/lib/prompts/image-extraction.ts` — same.
- `src/lib/prompts/unified-intent.ts` — same.
- `src/services/voice-intent.service.ts` — accept `targetDate` from input; pass to prompt + dispatcher; include `notes` in `taskContext`; truncate notes via shared helper.
- `src/services/text-process.service.ts` — same.
- `src/services/image-extraction.service.ts` — same.
- `src/services/unified-process.service.ts` — same.
- `src/services/action-dispatch.service.ts` — honor `action.targetDate` for `created`; fall back to `opts.today`.
- `src/lib/notes-context.ts` — **new file**. Single `truncateNotesForContext(notes: string | null): string | undefined` helper, used by all four services. (Better than duplicating the helper in each service.)
- `src/controllers/voice.controller.ts` — multer config gets `limits.fileSize`.
- `src/controllers/image.controller.ts` — multer config gets `limits.fileSize`.
- `src/middleware/error-handler.ts` (or wherever multer errors are caught) — translate `MulterError.LIMIT_FILE_SIZE` into a clean `413 FILE_TOO_LARGE` response.
- `src/repositories/task.repository.ts` — `listByDate` and `listOpenCarryOver` switch to `[{ updatedAt: 'desc' }]`. `listPending` stays as-is (it's the AI-context helper, not user-facing).
- `BACKEND_GUIDE.md` — document the new `targetDate` field on AI inputs, the new `targetDate` field on `created` outputs, and the multer size caps.

## Tasks

### 8.1 — Shared notes-truncation helper

Create `src/lib/notes-context.ts`:

```ts
const NOTES_CONTEXT_CHAR_LIMIT = 200;

export function truncateNotesForContext(notes: string | null): string | undefined {
  if (!notes?.trim()) return undefined;
  const trimmed = notes.trim();
  if (trimmed.length <= NOTES_CONTEXT_CHAR_LIMIT) return trimmed;
  const words = trimmed.split(/\s+/);
  let result = '';
  for (const word of words) {
    if ((result ? `${result} ${word}` : word).length > NOTES_CONTEXT_CHAR_LIMIT) break;
    result = result ? `${result} ${word}` : word;
  }
  return `${result}…`;
}
```

Why a helper: all four services need it. DRY + one place to tune the cap.

### 8.2 — Schema changes (one PR's worth)

For each of `text-process.schema.ts`, `voice-intent.schema.ts`, `image-process.schema.ts`, `unified-process.schema.ts`:

**Input — add optional `targetDate`:**

```ts
targetDate: z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'targetDate must be YYYY-MM-DD')
  .optional()
```

**Output (only for schemas that contain the `created` action variant) — extend that variant:**

```ts
z.object({
  type: z.literal("created"),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: priorityEnum.optional(),
  targetDate: z                          // ← NEW
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reasoning: z.string(),
})
```

Don't forget to regenerate the `PersistedAiAction` union in `action-dispatch.service.ts` so it includes `targetDate?` on the `created` variant.

### 8.3 — Prompt updates (the highest-leverage change in this sprint)

For each of the four prompt builders, add two sections **at the top of the prompt** (right after ROLE, before INPUT LANGUAGE):

```text
TODAY'S DATE: ${todayYmd} (YYYY-MM-DD, IST). Use this to interpret relative phrases:
  "today" / "aaj"                       → ${todayYmd}
  "tomorrow" / "kal" (future tense)     → ${tomorrowYmd}
  "yesterday" / "kal" (past tense)      → ${yesterdayYmd}
  "Friday" / "shukrawar"                → resolve to the upcoming Friday
  "next week"                           → resolve to the date 7 days from today

HINGLISH TENSE DISAMBIGUATION — IMPORTANT
You are an expert in Hinglish and Hindi grammar. Hindi uses the same word "kal" for both
"yesterday" and "tomorrow" — disambiguate using verbal tense:
  - "kal main ye kaam kiya"           → past tense ("kiya") → yesterday
  - "kal main ye kaam karunga"        → future tense ("karunga") → tomorrow
  - "kal ka meeting prepare karna hai" → future intent → tomorrow
  - "kal report submit kar di thi"     → past tense → yesterday
The same applies to "parso", "agle Friday", etc. Trust the tense, not the literal word.
```

And add a new rule in the RULES section (insert as Rule 4, push others down):

```text
4. TARGET DATE FOR CREATED ACTIONS
   If the user mentions a specific date or relative time ("kal", "Friday", "tomorrow morning",
   "next Monday"), resolve it against TODAY'S DATE above and include it as targetDate in the
   created action, formatted YYYY-MM-DD. If the user does NOT mention a date, OMIT targetDate
   entirely — the backend will default to today. Don't guess; only set targetDate when the user
   explicitly signaled a date.
```

And extend the pending-tasks JSON section so notes appear (Rule 2/EXISTING-TASK MATCH gets a clarifier):

```text
2. EXISTING-TASK MATCHING (priority_updated / completed / partial)
   Match user phrases primarily by task title. Notes (when present in the pending-tasks JSON)
   are supplementary context for disambiguating between similar titles — use them when title
   alone is ambiguous, NOT as a source of action intent. Use the exact "id" from the JSON.
   Do NOT invent or guess ids.
```

Each prompt builder gets a new signature: `buildVoiceIntentPrompt(pendingTasks, { today: Date })`. The today value is formatted via the existing `formatDateYMD` helper (the one already in the services).

### 8.4 — Service updates

For each of `voice-intent.service.ts`, `text-process.service.ts`, `image-extraction.service.ts`, `unified-process.service.ts`:

1. Accept `input.targetDate` (the new optional field).
2. Resolve the effective `today`:
   ```ts
   const today = input.targetDate
     ? parseDateString(input.targetDate)
     : todayInUserTz(DEFAULT_TIMEZONE);
   ```
3. Pass `today` to the prompt builder so the prompt's TODAY'S DATE header reflects this value.
4. Pass `today` to `dispatchAiAction` as before — created tasks default to this.
5. Include `notes` in the per-task context, via the shared helper:
   ```ts
   const taskContext = pending.map((t) => ({
     id: t.id,
     title: t.title,
     priority: t.priority,
     targetDate: formatDateYMD(t.targetDate),
     notes: truncateNotesForContext(t.notes),  // undefined values get dropped on JSON serialize
   }));
   ```

The `PendingTaskContext` type in each prompt file gains `notes?: string`.

### 8.5 — Action dispatcher: honor AI's `targetDate`

Update `action-dispatch.service.ts` — only the `created` case changes:

```ts
case "created": {
  const created = await taskRepo.create({
    userId: user.id,
    title: action.title,
    targetDate: action.targetDate
      ? parseDateString(action.targetDate)
      : opts.today,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    ...(action.notes !== undefined && { notes: action.notes }),
    ...(action.priority !== undefined && { priority: action.priority }),
  });
  return {
    type: "created",
    taskId: created.id,
    title: created.title,
    reasoning: action.reasoning,
    ...(action.notes !== undefined && { notes: action.notes }),
    ...(action.priority !== undefined && { priority: action.priority }),
    ...(action.targetDate !== undefined && { targetDate: action.targetDate }),
  };
}
```

Note: `opts.today` is the dispatcher's existing fallback (passed in from the service); `action.targetDate` is the new AI-supplied override.

### 8.6 — Multer size caps

In `voice.controller.ts` and `image.controller.ts` (or wherever multer is configured), add:

```ts
const upload = multer({
  storage: ...,
  limits: {
    fileSize: 10 * 1024 * 1024,  // 10 MB — matches frontend cap; covers ~5 min audio at typical bitrate
  },
});
```

If multer is shared across both endpoints in a single config, use the higher cap (10 MB) for both.

Translate `MulterError.LIMIT_FILE_SIZE` in the error middleware:

```ts
if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
  return res.status(413).json({
    error: 'FILE_TOO_LARGE',
    message: 'Uploaded file exceeds the 10 MB limit.',
  });
}
```

### 8.7 — Task repository sort

`task.repository.ts`:

```ts
export function listByDate(userId: string, date: Date): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, targetDate: date, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }],   // ← was [priority asc, createdAt asc]
  });
}

export function listOpenCarryOver(userId: string, today: Date): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, completed: false, deletedAt: null, targetDate: { lt: today } },
    orderBy: [{ updatedAt: 'desc' }],   // ← was [targetDate asc, createdAt asc]
  });
}
```

`listPending` stays unchanged — it's the AI-context helper, not user-facing, and the AI doesn't care about "recently touched" semantics.

### 8.8 — Doc updates

`BACKEND_GUIDE.md`:

- AI endpoints table: add `targetDate` as an optional input field on the four AI endpoints.
- Created-action response shape: add `targetDate` as an optional output field.
- New "Upload limits" section: 10 MB cap on `/voice/process` and `/images/process` with `413 FILE_TOO_LARGE` on violation.
- Tasks list endpoint: note the new sort order (`updatedAt desc`) so frontend doesn't get surprised.

## Acceptance Criteria

1. **`POST /voice/process` with `targetDate=2026-05-25`** + audio that says "kal report submit karna hai" → resulting task has `targetDate=2026-05-26` (the AI resolved "kal" relative to the request's targetDate). Without targetDate in request, the AI uses today-in-IST.
2. **`POST /text/process` with text "Tomorrow doctor ko milna hai"** → returns a `created` action with `targetDate` set to tomorrow's date.
3. **`POST /text/process` with text "Add task: review reports"** (no date phrase) → returns a `created` action WITHOUT `targetDate`. Task lands on today's date in DB.
4. **`POST /images/process` with text "kal main report submit kar di thi"** (past tense) → returns a `completed` action against the matching pending task. Even if no task matches, response goes to recommendations with completed=true — same as today.
5. **`GET /tasks?date=2026-05-23` after editing task X** → task X appears at top of the response (because `updatedAt desc`).
6. **`POST /voice/process` with a 15 MB audio file** → `413 FILE_TOO_LARGE` with the canonical error code.
7. **`POST /images/process` with an 11 MB JPEG** → same.
8. **AI prompt context now contains `notes` field for tasks that have them.** Verify by logging the constructed prompt during a smoke test.
9. **AI prompt context shows truncated notes** (≤200 chars + "…" appended) when source notes exceed 200 chars.
10. **`npm run lint` + `npm run build` green.** Existing curl smoke tests still pass (text/voice/image/unified all still create tasks correctly).
11. **No DB migration produced.** Schema is unchanged.

## Smoke test plan

Sync point with user before kickoff: confirm the prompt edits (especially the TENSE DISAMBIGUATION section + the new TARGET DATE rule), since prompt edits are the highest-leverage change here.

Manual curl smoke (after implementation):

```bash
# 1. Default behavior preserved (no targetDate, no relative phrase)
curl -X POST .../text/process -d '{"text":"add task: review reports"}'
# expect: created action, no targetDate, task lands today

# 2. Frontend-controlled targetDate (BUG-002)
curl -X POST .../text/process -d '{"text":"add task: review reports","targetDate":"2026-05-25"}'
# expect: created action, task lands on 2026-05-25

# 3. AI-resolved relative date (BUG-006)
curl -X POST .../text/process -d '{"text":"kal subah meeting prepare karna hai"}'
# expect: created action with targetDate=tomorrow, task lands tomorrow

# 4. Tense disambiguation
curl -X POST .../text/process -d '{"text":"kal report submit kar di thi"}'
# expect: completed action OR recommendation (if no matching task), NOT a created action for tomorrow

# 5. File size cap
curl -X POST .../voice/process -F "audio=@./big.webm" # 15 MB file
# expect: 413 FILE_TOO_LARGE

# 6. Sort order
curl -X PATCH .../tasks/<id> -d '{"title":"updated"}'
curl -X GET .../tasks?date=2026-05-23
# expect: the just-edited task is first in the response

# 7. Notes in context (verify via service-level log or test)
# Create two pending tasks with same title but different notes, then dictate something ambiguous.
# Expected: AI's reasoning string references the notes content for disambiguation.
```

## Hand-off Notes for the Executing Agent

- The Sprint 5 `VoiceAction` → `AiAction` rename mentioned in old sprint notes still hasn't happened. Don't rename in this sprint either — too much churn for an unrelated cleanup, and we're touching enough schema files already. Tag as polish.
- `parseDateString` already exists in `src/utils/date.ts`; reuse it.
- `formatDateYMD` already exists locally in each service (small duplicate). When you touch the services, consider extracting to `utils/date.ts` — but only if the diff is genuinely smaller. Don't do a sweeping refactor.
- The unified-intent endpoint may not be exercised by the current frontend, but keep parity so future surfaces don't have to chase the same fixes.
- Multer config may live in a shared `src/lib/upload.ts` or be inlined in each controller — adapt the diff accordingly. Pick the smaller change.
- Don't forget the `MulterError` branch in error middleware — without it, a too-large upload returns a generic 500 instead of a clean 413.
- Sort change is invisible at the API contract level (same response shape). But if the frontend has any logic that assumes prior ordering (e.g., "find the highest-priority unfinished task" — looking at the first item in the list), that assumption breaks. Worth flagging in the changelog so the frontend team can audit. Skim `Task-List/src/screens/TasksScreen.tsx` for any `tasks[0]` or `.find((t) => ...)` heuristic; if any rely on the old sort, they need to be made explicit.

## Verification Reporting Template

When done, append to this file under an `## Implementation Notes` heading:

- Files modified (one line each).
- Smoke curl results (paste the 7 curls + outputs from the smoke plan).
- `npm run lint` + `npm run build` results.
- Confirm the prompt's TENSE DISAMBIGUATION section was reviewed with user before lock-in (sync point).
- Anything surprising you found (e.g., Gemini ignoring the targetDate rule in certain audio inputs — would be worth flagging for a Phase-2 prompt tweak).

---

## Implementation Notes (2026-05-23, claude-session)

### Mid-sprint scope addition
**BUG-003 absorbed into this sprint.** Original direction was "hide reasoning from the frontend card" (frontend fix). User direction updated 2026-05-23: reasoning STAYS visible (it's valuable) — but the prompt must enforce brief + native-language + P.A. tone. So BUG-003 became a backend prompt rewrite, folded into the existing four-prompt edit pass. Net: six bugs solved in one sprint instead of five backend + one frontend.

### Files modified
- `src/lib/notes-context.ts` — **new** (32 LOC). Word-aware truncation to 200 chars + ellipsis, returns `undefined` for empty so the field drops out of the JSON.
- `src/utils/date.ts` — added `formatDateYmd` (extracted from per-service duplication) + `promptDateAnchors(today)` returning `{today, tomorrow, yesterday}` as YYYY-MM-DD.
- `src/schemas/voice-intent.schema.ts` — added `submitVoiceInputSchema` (optional `targetDate`); added optional `targetDate` to the `created` action variant.
- `src/schemas/text-process.schema.ts` — added optional `targetDate` to `submitTextInputSchema`.
- `src/schemas/image-extraction.schema.ts` — added `submitImageInputSchema` (optional `targetDate`).
- `src/schemas/unified-intent.schema.ts` — added `submitUnifiedInputSchema` (optional `text` + `targetDate`); added optional `targetDate` to the `created` action variant.
- `src/lib/prompts/voice-intent.ts` — full rewrite. New `BuildVoiceIntentPromptArgs` includes `today` + `tomorrow` + `yesterday`. Adds TODAY'S DATE anchor, Hindi tense disambiguation section, TARGET DATE rule for `created` actions, REASONING rule (native-language + P.A. tone + ≤ 20 words with explicit good/bad examples), notes-for-disambiguation rule on EXISTING-TASK MATCHING. ~120 lines, up from ~85.
- `src/lib/prompts/text-intent.ts` — same rewrite, adapted for text-only input. Signature now takes `BuildTextIntentPromptArgs` (the `userText` argument is now a field on the args object).
- `src/lib/prompts/image-extraction.ts` — same rewrite, with image-specific notes (TODAY anchor handles "27/05" handwritten dates; ambiguous-tense rule defaults to FUTURE for image task lists since they're forward-looking).
- `src/lib/prompts/unified-intent.ts` — same rewrite, modality-aware. Cross-modal contradiction rule preserved.
- `src/services/voice-intent.service.ts` — accepts new `SubmitVoiceInput`; resolves effective `today` from `input.targetDate` or `todayInUserTz` fallback; passes prompt anchors; includes truncated notes in pending-task context.
- `src/services/text-process.service.ts` — same pattern.
- `src/services/image-extraction.service.ts` — same pattern. Service signature gains optional `SubmitImageInput`.
- `src/services/unified-process.service.ts` — same pattern, plus `targetDate` flows from controller through `UnifiedProcessInput`.
- `src/services/action-dispatch.service.ts` — `PersistedAiAction.created` gains optional `targetDate`. Dispatcher honors `action.targetDate` (parses to Date) and falls back to `opts.today` when omitted.
- `src/controllers/voice.controller.ts` — parses `submitVoiceInputSchema` from `req.body`, passes `input` through to the service.
- `src/controllers/image.controller.ts` — same for `submitImageInputSchema`.
- `src/controllers/unified-process.controller.ts` — replaced inline `bodySchema` with `submitUnifiedInputSchema`, threads `targetDate` through.
- `src/controllers/text-process.controller.ts` — unchanged; existing parse-and-pass still works because the schema now carries `targetDate`.
- `src/middleware/upload.ts` — voice + image + multiModal caps unified to 10 MB (was 25 / 15 / 25).
- `src/middleware/error.ts` — `MulterError.LIMIT_FILE_SIZE` now returns `{ code: "FILE_TOO_LARGE", message: "Uploaded file exceeds the 10 MB limit." }` instead of multer's raw code+message.
- `src/repositories/task.repository.ts` — `listByDate` and `listOpenCarryOver` now `orderBy: [{ updatedAt: "desc" }]`. `listPending` unchanged (AI-context helper, not user-facing).

### `npm run typecheck` / `npm run lint` / `npm run build`
All green. Two iterations needed:
- First lint run flagged 4× `@typescript-eslint/no-non-null-assertion` (calling `truncateNotesForContext(t.notes)!` twice) and 1× `import-x/order` (notes-context.js between two `prompts` imports). Fixed by hoisting the truncation result to a local `const notesForContext` and reordering imports.
- Second run clean across `typecheck` + `lint` + `build`.

### Backend smoke test results (against running dev server, demo user)

```
=== 1. Frontend-supplied targetDate (BUG-002) ===
POST /text/process {"text":"add task: review reports","targetDate":"2026-05-25"}
→ task created on 2026-05-25 (confirmed via GET /tasks?date=2026-05-25)
→ reasoning: "New task added to your list." (English, brief — BUG-003 ✅)

=== 2. AI-resolved relative date, future tense (BUG-006) ===
POST /text/process {"text":"kal ward 12 me jaana hai"}
→ created action with targetDate: "2026-05-24" (tomorrow ✅)
→ reasoning: "Yeh kaam list pe nahi tha, naya task banaya." (Hinglish, brief, P.A. tone ✅)

=== 3. AI tense disambiguation, past tense ===
POST /text/process {"text":"kal main report submit kar di thi"}
→ no action created (correctly identified as past tense + no matching task)
→ routed to recommendation with completed=true
→ reasoning: "Yeh kaam list pe nahi tha, but aapne complete kar diya." (Hinglish, brief ✅)

=== 4. Sort order (BUG-004) ===
PATCH /tasks/<oldest_id> → just-edited task floats to top of GET /tasks?date=... ✅

=== 5. File size cap (BUG-009) ===
POST /voice/process with 11 MB upload
→ HTTP 413 {"error":{"code":"FILE_TOO_LARGE","message":"Uploaded file exceeds the 10 MB limit.","details":{"field":"audio"}}} ✅
```

Audio + image + unified curl smoke (the multimodal cases) not run in this pass — the changes are mechanical schema/prompt parity with text, and the dispatcher path is shared. Worth a manual round-trip from the frontend during FE Sprint 07 smoke-testing.

### Sync point note
The prompt rewrites (BUG-003 + BUG-006 Phase 1) WERE reviewed with the user before lock-in via the in-conversation BUGS.md update (the user explicitly approved "be the first prompt engineer in the world" framing + the P.A. tone + native-language match). User direction also updated mid-sprint to keep reasoning user-facing rather than hiding it — that's reflected in the rewritten REASONING rule on all four prompts.

### Anything surprising
- Multer middleware already had `LIMIT_FILE_SIZE → 413` mapping in `error.ts` — just needed to refine the response shape to use a stable `FILE_TOO_LARGE` code + clearer message instead of passing through multer's raw `LIMIT_FILE_SIZE` string. Trivial improvement, no behavior change.
- `formatDateYMD` was duplicated in four services. Consolidated to `src/utils/date.ts` as `formatDateYmd` (camelCase to match the rest of the file). Counts as one piece of incidental cleanup, but small enough not to be a scope creep.
- Gemini handled the new TENSE DISAMBIGUATION rule on the first try with no further prompt tuning. The explicit good/bad examples on the REASONING rule are doing real work — first smoke output was exactly the expected tone ("Yeh kaam list pe nahi tha, naya task banaya.") with no academic preamble.
- Backwards compatibility holds: the frontend currently does NOT send `targetDate` to AI endpoints, and the existing behavior (tasks land on today) is preserved when the field is omitted. Frontend Sprint 07 can land independently.
