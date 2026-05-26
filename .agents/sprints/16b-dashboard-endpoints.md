---
id: SPRINT-BE-16B
title: Dashboard Endpoints + AI Morning Brief
status: ready for review
date: 2026-05-26
tags: [sprint, backend, dashboard, rollups, ai-brief, vertex, submission-review]
related: [STATE, BE-SPRINT-16A, FE-SPRINT-16C, FE-SPRINT-16D, BE-SPRINT-15, BE-SPRINT-11]
parallel_with: Task-List/.agents/sprints/16d-dashboard-panels.md
owner: claude-session
estimated_effort: 1.5 days
depends_on: SPRINT-BE-16A (must be merged first)
---

# Backend Sprint 16B — Dashboard Endpoints + AI Morning Brief

## Mission

Sprint 16A landed the hierarchy bones. **You ship every dashboard endpoint, the AI Morning Brief, and the submission-review surface that Sprint 16D will consume to render the VP pitch demo.** This is the data-plane sprint — no UI, but every JSON response you produce is what a VP at KIMS sees in 5 days.

Two non-negotiable properties:

1. **Every endpoint is scope-correct.** The `resolveScope()` function from 16A is the single arbiter of what data leaves the server. A staff user must never see admin data; a Ward 12 lead must never see Surgery dept data. No per-endpoint permission re-implementation.
2. **Every group/dept KPI query JOINs on `GroupMembership`, not on `Task.groupId`.** This is L3. If your query reads `WHERE Task.groupId = ...`, you are wrong. AI-delegated tasks (the dominant creation path) carry `groupId: null`. The Ward 12 card must count tasks assigned to Ward 12's *members*, not tasks tagged with Ward 12.

---

## Required reading before any code

1. **This file's predecessor: [16a-hierarchy-foundation.md](./16a-hierarchy-foundation.md)** — read its `## Implementation Notes` section to learn what was actually shipped vs spec.
2. **[d:/gig_project/SPRINT16_DASHBOARD_DECISION_LOG.md](d:/gig_project/SPRINT16_DASHBOARD_DECISION_LOG.md)** §11 (API surface) and §12 (permission resolver).
3. **`C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md`** — L1-L9 at the top. Pay attention to L3 (JOIN by membership) and L2 (SubmissionReview join table).
4. **[Backend_task_list/src/services/activity.service.ts](Backend_task_list/src/services/activity.service.ts)** — the existing personal activity feed projection. You extend the same file for `scope=team` without breaking `scope=personal`.
5. **[Backend_task_list/src/lib/vertex.ts](Backend_task_list/src/lib/vertex.ts)** — `generateStructured()` signature. The AI Morning Brief uses this.
6. **[Backend_task_list/src/lib/prompts/meeting-intent.ts](Backend_task_list/src/lib/prompts/meeting-intent.ts)** — the pattern your morning-brief prompt mirrors (systemInstruction + per-request user content).
7. **[Backend_task_list/src/services/meeting.service.ts](Backend_task_list/src/services/meeting.service.ts)** — pattern for "service uses Vertex + structured schema + cache."
8. **[Backend_task_list/src/lib/errors.ts](Backend_task_list/src/lib/errors.ts)** — `AppError`, `NotFoundError`, `ConflictError`, `ForbiddenError`. Use these; don't invent new error types.

---

## Locked decisions you inherit

| # | Rule | Source |
|---|---|---|
| L2 | Per-manager submission review via `SubmissionReview` join table. Endpoint POST creates one row per (submission, reviewer). | Planning round (G2) |
| L3 | Dashboard rollups JOIN `GroupMembership` to find members, then count their tasks. `Task.groupId` is **not** the filter. | Planning round (G3) |
| D6 | Personal-Directs auto-provisioner lives in *this* sprint, runs lazily on first delegation by a manager who has no `isLead` group. | Source doc D6 |
| D9-modified | **No 8 AM IST cron** for the morning brief (G4 fix). Brief is generated on first dashboard-open per day per manager, cached. Refresh button regenerates with a 60s cooldown per (managerId). | Planning round (G4, G15) |
| D13 | Activity feed gains `scope=personal\|team` query param. Default `personal` preserves existing behavior. `scope=team` is scope-honest per L3/G8 — filter events by scope-object membership, not by user-id expansion. | Source doc D13, G8 fix |
| G9 | `/dashboard/groups` response filters `kind === "personal"` out by default. Optional query param `?include=personal` to include them. | Planning round (G9) |
| G10 | `/dashboard/meetings` filters via `resolveScope`, NOT by "owned-or-attendee-of." Admin sees org-wide meetings; group-lead sees meetings where any attendee is in their group. | Planning round (G10) |
| G15 | Vertex Refresh button rate-limited 60s per (managerId). 429 with `RATE_LIMITED` code if hit early. | Planning round (G15) |

---

## Scope

### In scope

- One new router: `/api/v1/dashboard/*`, gated by `requireManager`
- 10 dashboard rollup endpoints (overview, departments, groups, people, consistency, trends, meetings, activity, morning-brief, morning-brief/refresh)
- Submission review endpoints (mark-reviewed for plan + closure; unreviewed list filters)
- Department / Group / GroupMembership management endpoints
- Reminder demo stub endpoint
- AI Morning Brief: prompt + service + cache + endpoints + refresh cooldown
- Personal-Directs lazy provisioner (service-level only; called from `team/users/attach` per D14)
- Backwards-compat: `team/users/attach` extends per D14 (conditional)

### Out of scope

- Any FE work
- New AI prompts beyond morning-brief
- Schema changes (16A locked the schema)
- Notifications / real delivery for "Send Reminder"
- Weekly / monthly aggregated reports
- Async-job pattern for AI brief

---

## Phase 1 — Dashboard rollup router + shared service

### New files

- **`Backend_task_list/src/routes/dashboard.routes.ts`** — mount under `/api/v1/dashboard`, attach `jwtAuth` + `requireManager` at the router level
- **`Backend_task_list/src/controllers/dashboard.controller.ts`** — one handler per endpoint; shape: receive req, call service, return JSON
- **`Backend_task_list/src/services/dashboard-rollup.service.ts`** — every aggregate primitive shared across endpoints
- **`Backend_task_list/src/schemas/dashboard.schema.ts`** — zod schemas for query params + response shapes (for typed exports to FE)

### The shared service primitives

These are reused across multiple endpoints. Build them once, call them from controllers. All accept a `Scope` argument from 16A's `resolveScope()`.

```ts
// dashboard-rollup.service.ts — exports
export async function userIdsInScope(scope: Scope): Promise<string[]>;
// Returns the user.id list within the resolved scope.
// - org: all users where orgId = scope.orgId
// - dept: all users with any active GroupMembership in groups whose departmentId in scope.departmentIds
// - group: all users with active GroupMembership.groupId in scope.groupIds
// - reports-only: scope.reportIds + the manager themselves
// - none: []

export async function kpisForUsers(userIds: string[], targetDate?: Date): Promise<Kpis>;
// Returns { activeStaffToday, plansSubmittedToday, plansSubmittedPct,
//           closuresSubmittedToday, closuresSubmittedPct,
//           totalTasks, tasksDone, tasksDonePct }
// targetDate defaults to today (IST).

export async function trendForUsers(
  userIds: string[],
  metric: "tasks" | "plans" | "closures",
  days: number
): Promise<TrendSeries>;
// Returns { series: [{ date, value }], deltaPct }
// deltaPct = ((sum of last N days) - (sum of previous N days)) / previous, rounded to 0.1%

export async function consistencyForUsers(
  userIds: string[],
  days: number
): Promise<ConsistencyRow[]>;
// For each userId: count missed plan submissions + missed closure submissions
// in the last `days` days. Returns sorted by missedTotal desc.
// Row: { user: { id, name, role }, planMissedDays, closureMissedDays, lastSubmittedAt }
```

### Endpoints

All under `/api/v1/dashboard/*`, gated by `requireManager` at the router. Each handler:
1. Calls `resolveScope(req.user)`
2. If `scope.type === "none"` → 403 `FORBIDDEN` (defensive — staff shouldn't reach here past `requireManager`, but admin could be downgraded)
3. Calls the appropriate service primitive(s)
4. Returns JSON

| Method | Path | Query | Response shape (top-level) |
|---|---|---|---|
| GET | `/dashboard/overview` | — | `{ kpis, scope, asOf }` |
| GET | `/dashboard/departments` | — | `{ departments: DepartmentCard[] }` |
| GET | `/dashboard/groups` | `departmentId?, include?` | `{ groups: GroupCard[] }` |
| GET | `/dashboard/people` | `scope?, id?` | `{ people: PersonRow[] }` |
| GET | `/dashboard/consistency` | `days?` (default 7) | `{ rows: ConsistencyRow[] }` |
| GET | `/dashboard/trends` | `metric, range` (`7d`\|`30d`) | `TrendSeries` |
| GET | `/dashboard/meetings` | `date?` (default today) | `{ meetings: DashboardMeeting[] }` |
| GET | `/dashboard/activity` | `scope` (`team`\|`org`), `cursor?` | `{ events: ActivityEvent[], nextCursor? }` |

### Critical query patterns (L3-conformant)

**Wrong** (don't do this):
```ts
// Counts only tasks with explicit Task.groupId — misses all AI-delegated tasks
prisma.task.count({ where: { groupId: wardId, targetDate: today, completed: true } })
```

**Right** (L3 pattern):
```ts
// First: find user IDs who are active members of Ward 12 today
const memberIds = await prisma.groupMembership.findMany({
  where: { groupId: wardId, validTo: null },
  select: { userId: true },
}).then(rs => rs.map(r => r.userId));

// Then: count their tasks regardless of Task.groupId
prisma.task.count({
  where: { assigneeId: { in: memberIds }, targetDate: today, completed: true },
});
```

Apply this pattern everywhere. The `kpisForUsers(userIds)` primitive abstracts it — the controllers just pass `userIds`.

### Response type stability

Export every response shape from `dashboard.schema.ts` as a zod schema. FE-16C consumes these types via a hand-mirrored `Task-List/src/api/types.ts`. If you change a shape, update both.

---

## Phase 2 — AI Morning Brief

### New files

- **`Backend_task_list/src/lib/prompts/morning-brief.ts`** — prompt builder
- **`Backend_task_list/src/services/morning-brief.service.ts`** — generate + cache + cooldown
- **`Backend_task_list/src/repositories/morning-brief.repository.ts`** — Prisma access for cache (you add the cache MODEL in this sprint as a small schema addition — see below)

### One small schema addition (acceptable late delta)

Add to `schema.prisma` (separate migration named `add_morning_brief_cache`):

```prisma
model MorningBriefCache {
  managerId   String
  date        DateTime  @db.Date
  payload     Json
  generatedAt DateTime  @default(now())

  manager User @relation("MorningBriefManager", fields: [managerId], references: [id])

  @@id([managerId, date])
  @@index([managerId, generatedAt])
}
```

Also add `briefCaches MorningBriefCache[] @relation("MorningBriefManager")` to `User`. This is the only schema delta you ship in 16B.

### Prompt structure (mirror meeting-intent.ts)

**System instruction (durable):**
- ROLE: "You are an executive assistant briefing a hospital department head. You will receive today's submission and task numbers across the manager's scope, plus a list of people-to-watch and top performers. Your job is to produce a Hinglish (Roman script) narrative summary that a busy hospital manager can read in 15 seconds, plus 2-3 highlight bullets and 2-3 concern bullets."
- HINGLISH RULE — reuse `HINGLISH_REASONING_RULE` from shared-rules.ts; adapt wording to "narrative" not "reasoning."
- LANGUAGE RULE: summary in Hinglish (Roman); highlight/concern bullets short and scannable; "people-to-watch" mentions by first name only.
- TONE: P.A. tone — supportive, factual, not corporate. Founder-mandated.
- FIDELITY: do not invent numbers. If the input says "12 plans submitted," do not write "around 15 plans."
- LENGTH: summary 3-4 sentences MAX. Each bullet <= 12 words.
- AVOID: do not use Devanagari. Do not use emojis. Do not address the manager by name.

**Per-request user content:**
- TODAY'S DATE / WEEKDAY
- MANAGER NAME + DESIGNATION (for context only — do not address them)
- SCOPE LABEL (e.g., "Org-wide" / "Medicine department" / "Ward 12 group")
- TODAY'S KPI BLOCK (from `kpisForUsers`)
- 7-DAY TREND BLOCK (sparkline numbers)
- PEOPLE-TO-WATCH BLOCK (top 3 from `consistencyForUsers(7d)`, name + missed-days)
- TOP PERFORMERS BLOCK (top 2 with completion >= 90% in last 7d)
- ACTIVITY HIGHLIGHTS (last 3 noteworthy events from activity feed: e.g., "Meeting processed: Ward 12 handoff" / "12 tasks delegated via voice this morning")

**Vertex structured output schema** (zod):

```ts
export const morningBriefResponseSchema = z.object({
  summaryHinglish: z.string().min(20).max(800),
  highlights: z.array(z.string().max(120)).min(0).max(4),
  concerns: z.array(z.string().max(120)).min(0).max(4),
  topPerformers: z.array(z.object({ userId: z.string(), name: z.string() })).max(3),
  needsAttention: z.array(z.object({ userId: z.string(), name: z.string(), reason: z.string().max(120) })).max(3),
});
```

### Service flow

```ts
async function getMorningBrief(user, force = false): Promise<MorningBrief> {
  const today = todayInUserTz("Asia/Kolkata"); // existing helper
  if (!force) {
    const cached = await briefRepo.findCache(user.id, today);
    if (cached) return { ...cached.payload, fromCache: true };
  }
  // 60s cooldown check (force only)
  if (force && (await briefRepo.lastGeneratedAt(user.id)) > Date.now() - 60_000) {
    throw new AppError("RATE_LIMITED", 429, "Refresh available in <X> seconds.");
  }
  const scope = await resolveScope(user);
  if (scope.type === "none") throw new ForbiddenError();
  const userIds = await userIdsInScope(scope);
  const kpis = await kpisForUsers(userIds);
  const trend = await trendForUsers(userIds, "tasks", 7);
  const consistency = await consistencyForUsers(userIds, 7);
  // ... build prompt, call generateStructured, persist cache, return
}
```

### Endpoints

- `GET /dashboard/morning-brief` → return cached or generate (no cooldown check; first-of-day path)
- `POST /dashboard/morning-brief/refresh` → force-regenerate; honors cooldown; returns 429 if too soon

**Vertex cost discipline:** Each call is ~3-5K input tokens + ~500 output tokens with Flash. Cache aggressively. The morning brief should be generated at most ~20 times per day across the org for a 4-manager hospital.

---

## Phase 3 — Submission review (L2)

### New file

- **`Backend_task_list/src/repositories/submission-review.repository.ts`**:
  ```ts
  export async function createReview(submissionId, kind, reviewerId): Promise<SubmissionReview>;
  export async function listReviewersForSubmission(submissionId, kind): Promise<SubmissionReview[]>;
  export async function findReview(submissionId, kind, reviewerId): Promise<SubmissionReview | null>;
  ```

### Modified files

- **`Backend_task_list/src/services/day-plan.service.ts`** — add:
  ```ts
  export async function listUnreviewedPlans(reviewer: AuthenticatedUser): Promise<DayPlanSubmission[]>;
  // 1. resolveScope(reviewer) → userIdsInScope
  // 2. Find submissions in (userIds in scope, date in last 7 days)
  // 3. Filter to those where NO SubmissionReview row exists with this reviewer.id
  ```
- **`Backend_task_list/src/services/day-closure.service.ts`** — same shape.

### New endpoints

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/day-plan/:id/mark-reviewed` | Caller must be in scope of submission's owner. Creates SubmissionReview row keyed to caller. 409 if already exists. |
| POST | `/api/v1/day-closure/:id/mark-reviewed` | Same. |
| GET | `/api/v1/day-plan?unreviewed=true` | Returns unreviewed plans within caller's scope. |
| GET | `/api/v1/day-closure?unreviewed=true` | Same. |

### Demonstrate the matrix fix

Smoke verification: Sneha submits Monday. Sharma POSTs `/day-plan/<id>/mark-reviewed` → 200. Rahul GETs `/day-plan?unreviewed=true` → Sneha's submission **still appears** (Rahul has not reviewed). Rahul POSTs `/day-plan/<id>/mark-reviewed` → 200. Rahul's GET again → submission gone.

---

## Phase 4 — Management endpoints + Personal-Directs provisioner + Reminders

### Department / Group / Membership CRUD

All under `/api/v1/dashboard/*`. Permission rules:
- Departments: admin only for create/update
- Groups: admin OR dept-head (Department.headId === user.id) for create/update within their dept
- GroupMembership: admin OR group lead (isLead=true on the target group) for add/remove

| Method | Path | Body / Behavior |
|---|---|---|
| POST | `/dashboard/departments` | `{ name, headId? }` |
| PATCH | `/dashboard/departments/:id` | `{ name?, headId? }` |
| POST | `/dashboard/groups` | `{ name, kind, departmentId? }` |
| PATCH | `/dashboard/groups/:id` | `{ name?, kind?, departmentId? }` |
| POST | `/dashboard/groups/:id/members` | `{ userId, isLead?, canManage?, reason? }` — creates `GroupMembership` with `validFrom=now()`, `validTo=null` |
| DELETE | `/dashboard/groups/:id/members/:userId` | Closes the active membership (`validTo=now()`) — does NOT delete the row (audit) |

### Personal-Directs lazy provisioner (D6)

New file: **`Backend_task_list/src/services/personal-directs.service.ts`**

```ts
export async function ensurePersonalDirects(manager: User): Promise<ContextGroup>;
// 1. Check if manager has ANY active GroupMembership where isLead=true
//    -> if yes, return null (or throw "manager has explicit group; no shim needed")
// 2. Look up existing "Personal-Directs" group for this manager (by name + kind: "personal")
//    -> if exists, return it
// 3. Create a new ContextGroup: { name: `${manager.name}'s Directs`, kind: "personal", orgId: manager.orgId, departmentId: null }
// 4. Add manager as isLead:true, canManage:true
// 5. Return the group
```

Called from:
- `team/users/attach` endpoint (Sprint 14) — extend per D14: after attaching the user, if the attaching manager has no `isLead` group, ensure Personal-Directs exists and add the attached user to it. **Conditional** — fixes G16.
- Any future `team-action-dispatch` flow that needs a group context — but in this sprint, do not modify dispatch flow (out of scope).

### `/dashboard/reminders` endpoint (demo stub)

```ts
POST /api/v1/dashboard/reminders
Body: { targetUserId: string, kind: "plan" | "closure" }
Behavior:
  1. Validate target is in caller's scope
  2. Insert ReminderIntent row
  3. Return 200 { id, sentAt }
  // NO actual notification delivery. The UI toast is optimistic.
```

---

## Activity feed extension (D13 + G8)

Modify **`Backend_task_list/src/services/activity.service.ts`**:

```ts
export async function listActivity(
  user: AuthenticatedUser,
  query: ListActivityQuery & { scope?: "personal" | "team" | "org" }
): Promise<ActivityEvent[]>
```

- Default `scope=personal` → existing behavior, byte-identical
- `scope=team` → expand the userId filter via `userIdsInScope(resolveScope(user))`
- `scope=org` → admin only; otherwise treat as `team`

**G8 fix — filter by scope-object membership, not just by userId expansion:**

For meeting_processed events specifically: when scoping by `team`/`org`, an event is included only if at least one attendee or the meeting creator is in `userIdsInScope`. This prevents leaking a meeting that happens to include a user whose `creatorId` matches userIdsInScope but whose meeting attendees are otherwise outside the scope.

For task events: include if `assigneeId` OR `creatorId` is in `userIdsInScope`.

For AI batch events: include if the row's `userId` is in `userIdsInScope`.

For day_plan_submitted / day_closure_submitted: include if `userId` is in `userIdsInScope`.

---

## Acceptance criteria

- [ ] All 10 dashboard endpoints respond <300ms p95 with the 18-user seed
- [ ] AI Morning Brief generates in <5s, caches per (managerId, date), refresh respects 60s cooldown
- [ ] SubmissionReview: marking by Sharma does NOT clear Rahul's unreviewed list for the same submission
- [ ] All KPI queries JOIN GroupMembership (grep for `where: { groupId: ... }` in dashboard services — should be 0 results except `/dashboard/groups` listing groups themselves)
- [ ] Activity feed `scope=team` returns scope-filtered events for managers; `scope=personal` returns existing behavior byte-identical
- [ ] Personal-Directs lazy-provisions on first attach for a manager with no `isLead` group, skips otherwise
- [ ] `/dashboard/groups` excludes `kind: "personal"` by default
- [ ] `requireManager` gate is at the router level, not per-handler
- [ ] `npm run typecheck && npm run lint && npm run build` clean
- [ ] No changes to personal-flow files (grep diff: 0 changes in `voice-intent`, `text-intent`, `image-extraction`, `unified-intent`)

---

## Smoke matrix

Run against `localhost:8000` with seed loaded. Use bash + curl. Capture each user's JWT once at start via existing login flow.

| # | As user | Endpoint | Expected |
|---|---|---|---|
| B1 | Iyer (admin) | `GET /dashboard/overview` | scope.type = "org"; KPIs reflect all 18 users |
| B2 | Sharma | `GET /dashboard/overview` | scope.type = "dept" (Medicine); ~3-5 users counted |
| B3 | Rahul | `GET /dashboard/overview` | scope.type = "dept" (Nursing, since he's HOD); not "group" |
| B4 | Priya | `GET /dashboard/overview` | scope.type = "group" (OT-2 + OT Nursing Pool); 2 groups |
| B5 | Sneha (staff) | `GET /dashboard/overview` | 403 FORBIDDEN |
| B6 | Iyer | `GET /dashboard/departments` | 5 dept cards, each with KPIs |
| B7 | Sharma | `GET /dashboard/departments` | 1 dept card (Medicine only — her scope) |
| B8 | Iyer | `GET /dashboard/groups` | All groups EXCEPT any `kind: "personal"` |
| B9 | Iyer | `GET /dashboard/groups?include=personal` | Includes personal groups if any have been provisioned |
| B10 | Sharma | `GET /dashboard/consistency?days=7` | Sneha appears with `planMissedDays >= 2` (seed gaps) |
| B11 | Iyer | `GET /dashboard/morning-brief` | First call: generated. Second call within minute: returned from cache (`fromCache: true`) |
| B12 | Iyer | `POST /dashboard/morning-brief/refresh` (immediately after B11) | 429 RATE_LIMITED |
| B13 | Iyer | `POST /dashboard/morning-brief/refresh` after 60s | 200 with fresh content |
| B14 | Sharma | `POST /day-plan/<sneha-plan-id>/mark-reviewed` | 200 |
| B15 | Rahul | `GET /day-plan?unreviewed=true` | Sneha's plan STILL appears (Rahul has not reviewed) |
| B16 | Rahul | `POST /day-plan/<sneha-plan-id>/mark-reviewed` | 200 |
| B17 | Rahul | `GET /day-plan?unreviewed=true` (again) | Sneha's plan no longer appears |
| B18 | Sharma | `POST /day-plan/<sneha-plan-id>/mark-reviewed` (already reviewed) | 409 CONFLICT |
| B19 | Iyer | `POST /dashboard/groups` body `{ name: "ICU-B", kind: "ward", departmentId: medicine.id }` | 201 |
| B20 | Sharma | `POST /dashboard/groups/<icu-b.id>/members` body `{ userId: suresh.id }` | 200 |
| B21 | Sharma | `GET /dashboard/activity?scope=team` | Returns events for Medicine users only |
| B22 | Iyer | `GET /dashboard/meetings` | All processed meetings org-wide |
| B23 | Rahul | `GET /dashboard/meetings` | Meetings where any attendee is in Ward 12 / Night Shift |
| B24 | Sharma | `POST /dashboard/reminders` body `{ targetUserId: sneha.id, kind: "plan" }` | 200; row in ReminderIntent |
| B25 | Iyer | `GET /dashboard/trends?metric=tasks&range=7d` | series.length = 7; deltaPct present |

---

## Failure modes & escape hatches

**FM1 — Vertex rate limits in dev.** If your dev Vertex quota hits a wall during testing, hit the refresh endpoint less aggressively. Cache writes are atomic; an interrupted generation does NOT poison the cache (the cache row is only written on success).

**FM2 — JOIN performance on `kpisForUsers`.** With 18 users + 8 days × 5 tasks/user = ~720 tasks, no perf concerns. If you somehow hit slow queries: confirm `[assigneeId, targetDate]` index exists on Task (it should from a prior sprint). Don't add new indexes without explicit need.

**FM3 — `resolveScope` returning `reports-only` for a dept-head.** Should not happen — dept-head check runs before reports-only. If it does, you broke the 16A resolver ordering. Re-read 16A Phase 3.

**FM4 — Activity feed `scope=team` returning duplicates.** A meeting that includes 3 users in scope will be in the dataset 3 times if you `findMany` per user. Use `findMany({ where: { attendeeIds: { hasSome: userIdsInScope } } })` for meetings — Postgres array-contains-any. For task events, use `WHERE assigneeId IN (...) OR creatorId IN (...)` with a single query.

**FM5 — Morning Brief returns invalid Hinglish (Devanagari leakage).** The structured schema has no regex enforcement. Validate post-generation: if `summaryHinglish` contains `/[ऀ-ॿ]/`, regenerate once. If still bad, persist and surface a warning log; the UI will render the Devanagari and we'll fix the prompt.

---

## Handoff state at end of sprint

When you mark this sprint complete:

1. All 10 dashboard endpoints live and scope-correct
2. AI Morning Brief working with cache + cooldown
3. SubmissionReview matrix-correct
4. Personal-Directs provisioner ready, called from `attach` per D14 (conditional)
5. Activity feed has `scope=personal|team|org` and is byte-identical for `personal`
6. `morning-brief-cache` migration applied

**Write `## Implementation Notes` at the bottom:** which endpoints' response shapes diverged from this spec (if any — with rationale), AI brief output examples (paste 1-2 real Hinglish samples), and FM observations.

Sprint 16D reads that section before it starts wiring panels.

---

## What to update before closing

- [Backend_task_list/.agents/STATE.md](Backend_task_list/.agents/STATE.md) — Sprint 16B row + changelog
- This file — `## Implementation Notes`
- Bump the FE-mirrored API types doc if you keep one (otherwise just announce shapes in the Implementation Notes)

---

## Implementation Notes

Implemented on 2026-05-26.

### Schema / Migration

- Added the allowed 16B cache model:
  - `MorningBriefCache(managerId, date, payload, generatedAt)`
  - `User.briefCaches @relation("MorningBriefManager")`
- Migration file: `prisma/migrations/20260526172912_add_morning_brief_cache/migration.sql`
- Migration is additive and applied cleanly with the full reset path.

### Endpoint Surface

New `/api/v1/dashboard/*` router is mounted behind `jwtAuth` and router-level `requireManager`.

Implemented endpoints:

- `GET /dashboard/overview`
- `GET /dashboard/departments`
- `GET /dashboard/groups`
- `GET /dashboard/people`
- `GET /dashboard/consistency`
- `GET /dashboard/trends`
- `GET /dashboard/meetings`
- `GET /dashboard/activity`
- `GET /dashboard/morning-brief`
- `POST /dashboard/morning-brief/refresh`
- `POST /dashboard/departments`
- `PATCH /dashboard/departments/:id`
- `POST /dashboard/groups`
- `PATCH /dashboard/groups/:id`
- `POST /dashboard/groups/:id/members`
- `DELETE /dashboard/groups/:id/members/:userId`
- `POST /dashboard/reminders`

Submission review endpoints:

- `POST /day-plan/:id/mark-reviewed`
- `POST /day-closure/:id/mark-reviewed`
- `GET /day-plan?unreviewed=true`
- `GET /day-closure?unreviewed=true`

Activity:

- `GET /activity` now accepts optional `scope=personal|team|org`; default remains personal.
- `/dashboard/activity` returns `{ events }` and uses the same scoped projection.

### Response Shape Notes

- `/dashboard/activity` returns `{ events }`; cursor parsing exists but no cursor pagination is emitted yet because the existing activity projection is unpaginated. This preserves the underlying `ActivityEvent[]` contract while giving dashboard panels a wrapper.
- `/dashboard/people` supports optional `scope=dept|group&id=...` drill-down. Requested IDs are intersected with the caller's resolved scope.
- `reports-only` scopes return direct report IDs only. The 16A `Scope` shape does not include the manager's own id, so "manager themselves" from the original pseudo-code is not represented.

### AI Morning Brief

Works with cache + cooldown:

- First `GET /dashboard/morning-brief` generates and stores cache.
- Second GET for the same manager/date returns `fromCache: true`.
- Immediate `POST /dashboard/morning-brief/refresh` returns `429 RATE_LIMITED`.

Verified real sample:

> Aaj ka activity level kaafi light hai. Abhi tak koi naya plan ya closure submit nahi hua hai. Tasks bhi zero report kiye gaye hain. Kuch employees ke pending submissions par dhyan dena hoga.

The first run inside the sandbox failed with `EACCES` to `https://oauth2.googleapis.com/token`; rerunning with approved network access passed. No cache row is written on failed generation.

### Scope / Rollup Notes

- Dashboard task KPIs use scoped user IDs from `GroupMembership`, then count `Task.assigneeId`. No task KPI query filters by `Task.groupId`.
- `/dashboard/groups` excludes `kind: "personal"` by default and includes it only with `include=personal`.
- Meetings are scoped by creator OR attendee intersection with `userIdsInScope`.
- Reminder target validation uses `userIdsInScope(resolveScope(caller))`.

### Personal-Directs

Added `src/services/personal-directs.service.ts` and hooked it into `team/users/attach`.

Smoke verified:

- Mehta has no explicit non-personal `isLead` group.
- Attaching Suresh to Mehta creates `Dr. Mehta (Consultant, Surgery)'s Directs`.
- Mehta is inserted as lead/manage member.
- Suresh is inserted as a regular active member.
- Existing managers with explicit lead groups skip the shim.

### Verification

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run build` clean.
- `npx prisma migrate reset --force && npx tsx prisma/seed-hierarchy.ts` clean.
- HTTP smoke passed for:
  - admin/dept/staff dashboard overview scope and staff 403
  - departments, groups, consistency, trends, meetings, activity
  - per-reviewer SubmissionReview matrix behavior
  - reminder insert
  - Personal-Directs provisioning on attach
  - morning brief generation, cache, and refresh cooldown

End of Sprint 16B spec.
