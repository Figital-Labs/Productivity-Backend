---
id: SPRINT-09
title: Sprint 9 — History activity feed (derived projection)
status: checkpoint
owner: codex-session
started: 2026-05-23
completed: 2026-05-23
date: 2026-05-23
tags: [sprint, history, activity, projection, poc-scope]
related: [STATE, SPRINTS-INDEX, ADR-0024, FE-SPRINT-09]
---

# Sprint 9 — History Activity Feed (Derived Projection)

## Why this exists

The current History screen on the frontend is a flat list of past tasks — useful for "find a task" but boring for "see what I did this week". Product direction 2026-05-23 reframes History as a **story-style activity timeline**: grouped cards per day showing things like *"2 tasks created via voice", "5 from your image scan", "Day Plan submitted"*, expandable to show the individual task details.

The data needed already exists across `Task`, `VoiceInteraction.actions`, `ImageExtraction.actions`, `TextInteraction.actions`, `UnifiedInteraction.actions`, `DayPlanSubmission`, `DayClosureSubmission`. This sprint adds ONE endpoint that projects all of them into a uniform event stream.

**This is an explicitly POC-scoped approach** — see [ADR-0024](../decisions/0024-history-derived-projection.md). The full reasoning, scale limits, and migration trigger are documented there. Service code will repeat the scale-warning in a comment block.

This sprint can run **in parallel with [Frontend Sprint 09](../../../Task-List/.agents/sprints/09-history-activity-feed.md)** because frontend and backend touch disjoint files. The shared API contract is locked in this file (see "Backend Contract" section); frontend builds against the contract using a JSON fixture, then integrates against the real endpoint at the end.

## Goal

- Ship `GET /api/v1/activity?from=&to=` returning a sorted `ActivityEvent[]`.
- Cover 7 event types: voice-batch, text-batch, image-batch, unified-batch, manual-task-creation, task-completion, day-plan-submitted, day-closure-submitted.
- All-time default, optional date range.
- Document ADR-0024 in `BACKEND_GUIDE.md`.
- Include a scale-warning comment block at the top of `activity.service.ts`.

## Out of scope (intentionally)

- A dedicated `TaskAuditEvent` table — deferred per ADR-0024 until POC scale is exceeded.
- Deletion events, partial-toggle events, priority-change events, holiday-toggle events, note-activity events — explicit POC trim, see ADR-0024 "Out of scope".
- Pagination, search, filtering — POC data is small, no filter UI on frontend.
- Backfill or migration concerns.
- Caching layer.

## Backend Contract (single source of truth — frontend reads this section)

### Endpoint

```
GET /api/v1/activity
Authorization: Bearer <token>
```

### Query parameters (all optional)

```
?from=YYYY-MM-DD    Inclusive lower bound (UTC midnight of that date in IST)
?to=YYYY-MM-DD      Inclusive upper bound (end-of-day in IST)
```

If both omitted → all-time (capped at a sensible max — propose **last 365 days** to bound the query). If only `from` → "from that date until now". If only `to` → "all time up to that date".

Validation: zod parses both as YYYY-MM-DD; reject `from > to` with `400 INVALID_DATE_RANGE`.

### Response

```ts
ActivityEvent[]   // sorted DESCENDING by `at` (newest first)
```

### ActivityEvent discriminated union

```ts
type ActivityEvent =
  | {
      type: 'ai_voice_batch';
      at: string;                  // ISO 8601 timestamp of the VoiceInteraction.createdAt
      interactionId: string;
      summary: ActionCounts;
      affectedTasks: AffectedTask[];
      transcript?: string;         // present when VoiceInteraction.transcript is non-empty
    }
  | {
      type: 'ai_text_batch';
      at: string;
      interactionId: string;
      summary: ActionCounts;
      affectedTasks: AffectedTask[];
      inputText?: string;          // present when TextInteraction.inputText is non-empty
    }
  | {
      type: 'ai_image_batch';
      at: string;
      interactionId: string;
      summary: ActionCounts;
      affectedTasks: AffectedTask[];
      extractedText?: string;      // present when ImageExtraction.extractedText is non-empty
    }
  | {
      type: 'ai_unified_batch';
      at: string;
      interactionId: string;
      summary: ActionCounts;
      affectedTasks: AffectedTask[];
      // No transcript/extractedText — unified deliberately omits these per ADR-0021
    }
  | {
      type: 'task_created_manual';
      at: string;                  // task.createdAt
      task: { id: string; title: string; priority: 'low' | 'medium' | 'high' | null };
    }
  | {
      type: 'task_completed';
      at: string;                  // task.updatedAt — see lossy-toggle caveat in ADR-0024
      task: { id: string; title: string };
    }
  | {
      type: 'day_plan_submitted';
      at: string;                  // submittedAt
      submissionId: string;
      date: string;                // YYYY-MM-DD — the date being planned
      taskCount: number;           // number of tasks in the taskSnapshot
    }
  | {
      type: 'day_closure_submitted';
      at: string;
      submissionId: string;
      date: string;                // YYYY-MM-DD
      hasAiFeedback: boolean;      // true if aiFeedback.summary is non-empty
    };

interface ActionCounts {
  created: number;
  completed: number;
  partial: number;
  priority_updated: number;
}

interface AffectedTask {
  id: string;
  title: string;
  action: 'created' | 'completed' | 'partial' | 'priority_updated';
}
```

### Sample response (for frontend fixture)

```json
[
  {
    "type": "day_plan_submitted",
    "at": "2026-05-23T11:30:00.000Z",
    "submissionId": "cmpiaaaa0000",
    "date": "2026-05-23",
    "taskCount": 7
  },
  {
    "type": "ai_voice_batch",
    "at": "2026-05-23T10:30:00.000Z",
    "interactionId": "cmpibbbb0000",
    "summary": { "created": 2, "completed": 1, "partial": 0, "priority_updated": 0 },
    "affectedTasks": [
      { "id": "cmpit1", "title": "Review patient files", "action": "created" },
      { "id": "cmpit2", "title": "Submit insurance form", "action": "created" },
      { "id": "cmpit3", "title": "Daily rounds", "action": "completed" }
    ],
    "transcript": "Review patient files, submit insurance form, and I finished daily rounds"
  },
  {
    "type": "task_created_manual",
    "at": "2026-05-23T11:15:00.000Z",
    "task": { "id": "cmpit4", "title": "Call Dr Sharma", "priority": null }
  },
  {
    "type": "task_completed",
    "at": "2026-05-23T11:45:00.000Z",
    "task": { "id": "cmpit5", "title": "Quarterly report" }
  }
]
```

### Caveats called out in the contract

- **`task_completed.at` is `task.updatedAt`, not the actual completion moment.** If the user toggled complete → incomplete → complete, only the final timestamp is captured. ADR-0024 documents this lossy behavior. The frontend should treat it as approximate.
- **`task_created_manual` events fire only when `sourceType === 'manual'`.** AI-created tasks appear inside their respective AI batch events (and do NOT also appear as standalone `task_created_*` events).
- **Tasks created by AI then later completed manually** produce TWO events: the AI batch event (with `action: 'created'` for that taskId) AND a `task_completed` event for the same taskId. That's intentional — they're two distinct moments in the user's day.

## Files In Scope

- `.agents/sprints/09-history-activity-feed.md` — this file. Status `scoped` → `checkpoint` after verification.
- `.agents/STATE.md` — append Sprint 09 changelog entry, flip Sprint 09 row.
- `.agents/sprints/README.md` — Sprint 09 status row.
- `.agents/decisions/0024-history-derived-projection.md` — already exists; referenced from this sprint.
- `BACKEND_GUIDE.md` — new "Activity feed" section under API Reference.
- `src/schemas/activity.schema.ts` — **new**. The `ActivityEvent` union as zod schemas, query schema, response schema.
- `src/services/activity.service.ts` — **new**. The projection logic. Top-of-file comment block reproduces ADR-0024's scale-warning.
- `src/controllers/activity.controller.ts` — **new**. Thin layer.
- `src/routes/activity.routes.ts` — **new**. Single `GET /` route.
- `src/routes/v1.ts` — mount `activity.routes` at `/api/v1/activity`.

**Do NOT modify:**

- `src/services/task.service.ts`, `src/services/voice-intent.service.ts`, `src/services/text-process.service.ts`, `src/services/image-extraction.service.ts`, `src/services/unified-process.service.ts`, `src/services/day-plan.service.ts`, `src/services/day-closure.service.ts` — the activity service READS from their persisted shapes via repositories, doesn't extend them.
- Any prompt files.
- Any frontend files.
- Prisma schema. No migrations.

## Tasks

### 9.1 — Zod schemas

`src/schemas/activity.schema.ts`:

- `listActivityQuerySchema` — `{ from?: ymd, to?: ymd }` with `.refine()` rejecting `from > to`.
- `actionCountsSchema` — `{ created, completed, partial, priority_updated }` all `z.number().int().nonnegative()`.
- `affectedTaskSchema` — `{ id, title, action }` where action is `z.enum(['created','completed','partial','priority_updated'])`.
- `activityEventSchema` — discriminated union per the contract above. Use `z.discriminatedUnion('type', [...])`.

Export TypeScript types via `z.infer`.

### 9.2 — Repository helpers (read-only)

You may add small read-only helpers to existing repositories if the projection logic needs them — e.g., `taskRepo.listManualCreatedSince(userId, from, to)` if you want a filter to push down to the DB instead of in-memory.

Recommendation: add three new repository functions to keep the projection clean:

- `taskRepo.listManualCreatedInRange(userId, from?, to?)` — `where: { userId, sourceType: 'manual', createdAt: {gte, lte}, deletedAt: null }`.
- `taskRepo.listCompletedInRange(userId, from?, to?)` — `where: { userId, completed: true, updatedAt: {gte, lte}, deletedAt: null }`.
- (Optionally) extend the existing AI-interaction repositories with `listInRange(userId, from?, to?)` returning the full row (including `actions` JSON).
- Existing `dayPlanRepo` / `dayClosureRepo` likely have `listSubmittedInRange` already; if not, add them.

Keep the actual projection logic in the service, not the repositories.

### 9.3 — Projection service

`src/services/activity.service.ts`:

```ts
/**
 * ⚠️ POC SCOPE ONLY — see ADR-0024.
 *
 * This service projects an activity feed by querying 5–6 tables and merging
 * their rows into a uniform ActivityEvent stream. It is fast at POC scale
 * (~hundreds of tasks per user) and intentionally lossy on state-toggle history
 * (we only see the latest `completed` / `updatedAt`, not every toggle).
 *
 * Migration trigger to a dedicated TaskAuditEvent table:
 *   - >5K tasks per user OR P95 latency > 250ms
 *   - Need for toggle-history fidelity
 *   - Real analytics queries
 *
 * When migrating, the frontend contract (ActivityEvent[]) does NOT change —
 * only this file's internals.
 */
```

Then:

1. Compute IST date-range bounds from `query.from` / `query.to`.
2. Fire all read queries concurrently with `Promise.all` (the four AI-interaction lists, the manual-created tasks list, the completed-tasks list, the day-plan submissions list, the day-closure submissions list).
3. For each AI interaction row, build one `ai_<type>_batch` event:
   - `summary`: count by `action.type` across `interaction.actions[]`.
   - `affectedTasks`: build `{ id: action.taskId, title: <looked up>, action: action.type }`. Title lookup → see 9.4 below.
   - Conditional `transcript` / `inputText` / `extractedText` fields per the contract.
4. For each manual-sourced `Task`, build one `task_created_manual` event.
5. For each completed `Task` (where `completed=true`), build one `task_completed` event keyed off `updatedAt`. Skip tasks that are deletedAt-set.
6. For each `DayPlanSubmission` / `DayClosureSubmission`, build the appropriate event.
7. Merge all events into one array. Sort by `at` DESCENDING.
8. Return.

### 9.4 — Title-lookup strategy for `affectedTasks`

The AI interaction rows persist `actions[]` with `taskId` but not the task title (we read titles by joining or by a separate fetch). Two options:

- **(a) Per-interaction batch fetch.** Collect all `taskId`s from all interactions in the response, fire ONE `taskRepo.listByIds(userId, taskIds)` query (use `findMany({ where: { id: {in: ...} } })`), then map back into each event's `affectedTasks` array. **Recommend this.**
- **(b) Trust the persisted action object's `title` field.** Looking at `dispatchAiAction`, the persisted `created` action carries `title` directly. For `created` events the title is right there. For `completed` / `priority_updated` / `partial`, only `taskId` exists in the action — needs (a) for those.

Use a hybrid: prefer `action.title` when it exists in the persisted JSON; fall back to a batched `listByIds` for the action types that don't carry it.

Edge case: if a task referenced by an action has since been deleted, the title lookup misses it. Either omit that row from `affectedTasks` (cleaner) OR show "(deleted task)" (more informative). Recommend OMIT — keeps the timeline cleaner.

### 9.5 — Controller + route

`src/controllers/activity.controller.ts`:

```ts
export async function list(req: Request, res: Response): Promise<void> {
  const query = listActivityQuerySchema.parse(req.query);
  const events = await activityService.listActivity(req.user, query);
  res.json(events);
}
```

`src/routes/activity.routes.ts`:

```ts
const router = Router();
router.get('/', activityController.list);
export default router;
```

Mount in `v1.ts` at `/api/v1/activity` AFTER the auth middleware (matches the pattern for other protected routes).

### 9.6 — BACKEND_GUIDE.md updates

Add a new section under API Reference:

```
### GET /api/v1/activity

Returns the user's activity timeline as a sorted descending stream of
ActivityEvent objects. Used by the frontend History screen.

**Query parameters (all optional):**
  from=YYYY-MM-DD    Inclusive lower bound (IST midnight)
  to=YYYY-MM-DD      Inclusive upper bound (IST end-of-day)

If both omitted, returns last 365 days.

**Response:** `ActivityEvent[]` — see schema in src/schemas/activity.schema.ts.

**Caveats:**
  - task_completed events use task.updatedAt as the timestamp (lossy on toggle).
  - Deleted tasks are excluded from affectedTasks.
  - Sprint-9 implementation is a derived projection; see ADR-0024 for scope.
```

Also add ADR-0024 to the architecture-decisions list section in BACKEND_GUIDE.md if there's a list.

## Acceptance Criteria

1. **Smoke test for each event type.** Seed (manually via curl or fixtures) → call `/activity` → confirm each event type appears with the right shape.
2. **Sort order.** Response is newest-first (descending by `at`).
3. **Date range filter.** `?from=2026-05-20&to=2026-05-22` excludes events outside that range.
4. **Date validation.** `?from=2026-05-25&to=2026-05-20` returns 400 `INVALID_DATE_RANGE`.
5. **Default range bound.** No params → at most 365 days of history.
6. **Deleted tasks.** A task that was created then deleted does NOT appear in `task_created_manual` (and its taskId is omitted from `affectedTasks` of any AI batch).
7. **`task_completed` excludes incomplete tasks.** Only `completed: true && deletedAt: null`.
8. **`ai_*_batch` events carry the right summary counts.** Manually verify by counting actions in the corresponding interaction row.
9. **No N+1.** The projection should fire a bounded number of queries (~7 — one per source table plus the batched title lookup), regardless of how many events.
10. **`npm run lint` + `npm run typecheck` + `npm run build` all green.**
11. **No DB migration produced.**

## Verification — curl smoke plan

```bash
# Login → get token
TOKEN=$(curl -s -X POST .../auth/login -d '{"email":"demo@kims.local","password":"demopass123"}' | jq -r .token)

# 1. Default (all-time, last 365 days)
curl -s "/activity" -H "Authorization: Bearer $TOKEN" | jq '. | length, .[0].type, .[0].at'

# 2. Filtered range
curl -s "/activity?from=2026-05-20&to=2026-05-23" -H "Authorization: Bearer $TOKEN"

# 3. Bad range → 400
curl -s -w "%{http_code}" "/activity?from=2026-05-25&to=2026-05-20" -H "Authorization: Bearer $TOKEN"

# 4. Each event type present (do a voice/text/image POST first then check the activity feed)
curl -s -X POST .../text/process -d '{"text":"add: review report"}' -H "Authorization: Bearer $TOKEN"
curl -s "/activity?from=$TODAY" -H "Authorization: Bearer $TOKEN" | jq '.[].type'
# Expect to see: ai_text_batch + (after dispatching the new task is in DB) task_completed? — no, only created. Manual completion needs a separate PATCH.
```

## Hand-off Notes for the Executing Agent

- **Parallel with [Frontend Sprint 09](../../../Task-List/.agents/sprints/09-history-activity-feed.md).** The frontend has the contract locked above and a sample JSON. They'll build the UI against a JSON fixture, then integrate against the real endpoint once you ship it. You can ship without coordinating with them mid-sprint.
- **The persisted `actions` JSON in each `VoiceInteraction` / `ImageExtraction` / `TextInteraction` / `UnifiedInteraction` row is the source of truth for batch events.** Don't try to reconstruct from `Task.sourceType` + `Task.sourceId` — the actions JSON already has everything (counts, taskIds, individual action types). This is exactly what ADR-0012 ("AI output persistence") was designed for.
- **Day-closure submissions can also have action-bearing AI output** (via the closure's voice flow that runs through `dispatchAiAction`). Those actions are already counted IN the day-closure's own `actions` field if persisted there, OR they may appear separately in the underlying voice/text flow. Verify whichever path the current implementation uses; if both, you get duplicate events. Sprint 4 wired the day-closure flow — check it.
- The `UnifiedInteraction.actions` field includes a `source` discriminator per action ('voice'/'image'/'text'). Don't split a unified batch into three sub-events — keep it as one `ai_unified_batch` with the aggregate counts.
- For `transcript` / `inputText` / `extractedText` fields: only include in the event response when the source string is non-empty. Cheaper response payload + cleaner schema check on the frontend.
- The contract says response is sorted descending by `at`. Confirm via a unit-style smoke check; don't rely on Postgres ordering across multiple queries.
- Stop after verification + report back per the template.

## Verification Reporting Template

When done, append to this file under an `## Implementation Notes` heading:

- Files added (each new file: one line).
- Curl smoke results (paste the 4+ smoke outputs).
- Confirm `task_completed.at` uses `updatedAt`, and the lossy caveat is in the service's top-of-file comment.
- `npm run lint` / `npm run typecheck` / `npm run build` results.
- Anything surprising (e.g., a corner case in the day-closure double-event question above).

---

## Implementation Notes (2026-05-23, codex-session — verified + closed-out by claude-session)

> **Closure note:** codex shipped the full code + ran curl smoke against the live dev server (test data is visible in the response — manual + text-batch + completion events all roundtripping). Codex hit its context limit before flipping docs status / writing this Implementation Notes section. Claude-session verified the implementation post-hoc and is closing the docs.

### Files added
- `src/schemas/activity.schema.ts` — `listActivityQuerySchema` with `.refine()` for the date-range check, `activityEventSchema` discriminated union for the 8 event types (4 AI batches + manual creation + completion + 2 submissions), `actionCountsSchema`, `affectedTaskSchema`. 105 LOC.
- `src/services/activity.service.ts` — projection logic. Top-of-file scale-warning comment block reproduces ADR-0024's guidance. IST-anchored date bounds via `startOfIstDay` / `endOfIstDay`. Parallel `Promise.all` of 8 queries (no N+1). Title lookup via batched `taskRepo.listByIds`. Deleted tasks correctly omitted from `affectedTasks` (lookup miss → skip). Sorted descending by `at` at the end. 251 LOC.
- `src/controllers/activity.controller.ts` — thin parse-and-dispatch; converts the refine-failure case to a proper `INVALID_DATE_RANGE` 400 with `AppError`. 21 LOC.
- `src/routes/activity.routes.ts` — single `GET /` route. 7 LOC.

### Files modified
- `src/routes/v1.ts` — mounts `activityRouter` at `/api/v1/activity` behind auth.
- `src/repositories/task.repository.ts` — added `listByIds`, `listManualCreatedInRange`, `listCompletedInRange`. `listPending` unchanged.
- `src/repositories/voice.repository.ts`, `text-interaction.repository.ts`, `image.repository.ts`, `unified-interaction.repository.ts` — each gained a `listInRange(userId, from?, to?)`.
- `src/repositories/day-plan.repository.ts`, `day-closure.repository.ts` — `listSubmittedInRange(userId, from?, to?)`.
- `BACKEND_GUIDE.md` — new "Activity feed" section documenting `GET /api/v1/activity` and ADR-0024.

### `task_completed.at` uses `updatedAt` ✅
Confirmed at [activity.service.ts:228](../src/services/activity.service.ts#L228). The lossy-toggle caveat is captured in the service's top-of-file comment block + ADR-0024.

### `npm run typecheck` / `npm run lint` / `npm run build`
All green. Verified by claude-session.

### Curl smoke results

```
=== /activity (default range, with seeded data) ===
[
  { "type":"ai_text_batch", "at":"2026-05-23T16:37:37.104Z",
    "interactionId":"cmpiknopc...", "summary":{"created":1,"completed":0,"partial":0,"priority_updated":0},
    "affectedTasks":[{"id":"cmpiko1jq...","title":"Smoke text task","action":"created"}],
    "inputText":"add activity smoke text task" },
  { "type":"task_completed", "at":"2026-05-23T16:37:37.090Z",
    "task":{"id":"cmpiknoog...","title":"Activity smoke manual 220737"} },
  { "type":"task_created_manual", "at":"2026-05-23T16:37:37.072Z",
    "task":{"id":"cmpiknoog...","title":"Activity smoke manual 220737","priority":null} },
  ... (older task_completed events sorted descending)
]

=== /activity?from=2026-05-23&to=2026-05-22 (bad range) ===
HTTP 400 {"error":{"code":"INVALID_DATE_RANGE","message":"`from` must be on or before `to`."}}
```

Verified: sort order is descending by `at`, `affectedTasks` carries title via `listByIds`, `inputText` is included only when non-empty.

### Anything surprising
- The persisted `actions` JSON in each interaction row sometimes carries an `action.title` field (for `created` actions). The service ignores it in favor of always looking up the canonical title via `taskRepo.listByIds`. That's the right call — if the user edited the task title later, the projection shows the LATEST title, not the create-time snapshot. Documented in code via the title-lookup design.
- Deletion behavior: if a task referenced in an AI batch's `actions` has since been soft-deleted, the title lookup misses it and the action is silently filtered out of `affectedTasks`. The batch summary counts remain correct (still counts that action against `created` / `completed` / etc.), so users see "AI Voice Tasking · 2 created" even if one of the two has since been deleted. Acceptable POC behavior. ADR-0024 documents this.
- The day-closure double-event question (whether closure-flow AI actions ALSO appear as a separate voice-batch) — codex's implementation reads from VoiceInteraction directly via `voiceRepo.listInRange`, so any voice-interaction row from the closure flow would surface as `ai_voice_batch`. If that produces duplicate visual context with the `day_closure_submitted` event, it's worth a polish-pass review. Not blocking.
