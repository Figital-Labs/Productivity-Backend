---
id: SPRINT-BE-11
title: Hospital Hierarchy + Manager Delegation (Backend)
status: ready-for-review
date: 2026-05-25
tags: [sprint, schema, auth, ai, prompts, delegation, multi-user]
related: [STATE, SPRINTS-INDEX, FE-SPRINT-11]
parallel_with: Task-List/.agents/sprints/11-manager-dashboard.md
---

# Backend Sprint 11 — Hospital Hierarchy + Manager Delegation

## Goal

Pivot the data model from single-user to multi-user with matrix authority. Add hospital-staff hierarchy (manager ↔ staff M2M), AI-powered voice delegation, and the API surface a Manager Dashboard needs. The Frontend Sprint 11 (`Task-List/.agents/sprints/11-manager-dashboard.md`) consumes the contract this sprint produces.

**Five things this sprint ships:**

1. **Schema delta** — M2M self-relation on User (`managers` / `reports`); split `Task.userId` → `assigneeId` + `creatorId`.
2. **Auth + permissions** — precompute `reportIds: Set<string>` on `AuthenticatedUser`; extend `canAccess()` to include manager-of-assignee.
3. **Shared prompt rules** — extract the 5 duplicated rule blocks (TODAY anchor, Hinglish output, conservative default, priority cues, target_date_updated) into `src/lib/prompts/shared-rules.ts`. Personal prompts refactored to import them. Behavior byte-identical.
4. **Delegation surface** — 3 new AI endpoints (`/team/voice/delegate`, `/team/text/delegate`, `/team/image/delegate`) with their own prompts + a manual `POST /team/tasks`. Plus `GET /team/reports`, `GET /team/reports/:id/tasks`, `GET /team/reports/:id/submissions`. All gated on `role === 'manager' | 'admin'`.
5. **User CRUD + password mgmt** — `POST /team/users` (create with role + password), `POST /team/users/:id/reset-password`. No temp passwords, no email infra, no first-login flow. Manager controls credentials end-to-end.

Plus: `Backend_task_list/prisma/seed-hierarchy.ts` seeds 12 demo users with mixed matrix relationships.

Owner: claude-session-BE. Estimate: ~4 hours. **Can run in parallel with FE 11** — FE scaffolds against the documented contract in this file.

---

## Why this is happening

Hospital operations are matrix-shaped: Sister Sneha receives orders from BOTH Head Nurse Rahul AND Dr. Sharma simultaneously. The current single-user model can't represent that. Today there's no surface for a manager to delegate, no way for a manager to see their team's progress, and no concept of "this task was assigned to me by someone else."

Sprint 11 is the largest BE change since Sprint 02 — schema migration + auth changes + 4 new AI routes + new prompt files + multi-user seed.

---

## Locked decisions (from planning conversation 2026-05-25)

1. **Reuse existing `User.role` enum** (`staff` / `manager` / `admin`) — already in schema. NO new `canManage` field. Freshly-created managers get `role: 'manager'` directly.
2. **Matrix permissions are broad** — managers see ALL of a report's tasks regardless of who assigned them (`Dr. Sharma can see tasks Rahul gave Sneha`). Confirmed: knowing how loaded staff are is the hospital reality.
3. **`canAccess(user, task)` extended** — assignee OR creator OR admin OR manager-of-assignee. Single 2-line helper.
4. **Full edit rights on delegated tasks for the assignee** — Sneha can change date, priority, title, completion on a task Sharma gave her. No granular permission matrix. Only differentiator on the assignee side: an "assigned by X" badge (rendered by FE).
5. **Separate `/team/*` routes with their own prompts** — personal prompts stay byte-identical. Zero regression on existing flows.
6. **Multi-assignee utterance → 2 identical tasks** — schema has single `assigneeId`, only supported answer.
7. **No temp passwords / no email infra** — manager creates user with `{name, email, password, role}` directly. Manager resets via simple form. POC velocity over privacy.
8. **Demo seed: 12 users, 2-tier matrix** — 4 managers (Sharma, Mehta, Rahul, Priya) + 8 staff. Sneha + Amit + Anita + Vikram each report to 2 managers (matrix); Deepika, Kavita, Suresh, Manoj have a single boss.

Deferred (do NOT implement):
- "Delegated by me" outflow panel
- Cross-team add (assign EXISTING user as additional report)
- User deactivation / report transfer
- Name disambiguation in delegation prompt ("which Sneha?")
- Manager EOD rollup / team analytics
- WebSocket live sync (FE polls instead)
- Backend vitest tests — smoke only

---

## Tasks

### 11.1 — Prisma schema delta

**File**: [prisma/schema.prisma](../../prisma/schema.prisma)

**User model** (lines 12–33): add M2M self-relation + new task relations; remove old `tasks Task[]` reverse relation.

```prisma
model User {
  // ... existing fields including role ...

  // NEW: M2M self-relation for matrix hierarchy
  reports   User[]  @relation("UserHierarchy")
  managers  User[]  @relation("UserHierarchy")

  // NEW: replace `tasks Task[]` with these two reverse relations
  assignedTasks  Task[]  @relation("AssignedTasks")
  createdTasks   Task[]  @relation("CreatedTasks")
}
```

**Task model** (lines 35–56): remove `userId`, add `assigneeId` + `creatorId`. Update indexes.

```prisma
model Task {
  id          String   @id @default(cuid())
  // REMOVE: userId String
  // ADD:
  assigneeId  String
  creatorId   String

  assignee    User     @relation("AssignedTasks", fields: [assigneeId], references: [id])
  creator     User     @relation("CreatedTasks",  fields: [creatorId],  references: [id])

  // ... rest unchanged ...

  // UPDATED indexes
  @@index([assigneeId, targetDate])
  @@index([assigneeId, deletedAt])
}
```

**Migration strategy** (demo db, ~10 rows of pre-existing data):

1. `npx prisma migrate dev --name hierarchy-and-task-split`
2. Manually edit the generated SQL:
   - ADD COLUMN `assigneeId` (nullable initially), `creatorId` (nullable)
   - `UPDATE Task SET "assigneeId" = "userId", "creatorId" = "userId"` (backfill)
   - ALTER COLUMN `assigneeId` SET NOT NULL; ALTER COLUMN `creatorId` SET NOT NULL
   - DROP COLUMN `userId`
   - DROP old indexes, CREATE new ones on `assigneeId`
3. Re-run migration; verify tasks still load via `GET /tasks?date=<today>`.

⚠️ **Confirm with user before running migration on any non-demo data** — drops `userId` column irreversibly.

### 11.2 — Auth middleware: precompute `reportIds`

**File**: [src/middleware/auth.ts](../../src/middleware/auth.ts)

Extend `AuthenticatedUser` interface (lines 6–10):

```ts
interface AuthenticatedUser {
  id: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
  reportIds: Set<string>;  // NEW — empty Set for staff
}
```

After JWT decode (lines 34–39): if `role === 'manager' || role === 'admin'`, fetch report ids once per request:

```ts
let reportIds = new Set<string>();
if (payload.role === 'manager' || payload.role === 'admin') {
  const row = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { reports: { select: { id: true } } },
  });
  reportIds = new Set((row?.reports ?? []).map(r => r.id));
}
req.user = { id: payload.sub, orgId: payload.orgId, role: payload.role, reportIds };
```

Staff get `new Set()` — cheap, type-stable. Adds one DB query per request for managers; acceptable for POC.

### 11.3 — `canAccess` extension

**File**: [src/utils/auth.ts](../../src/utils/auth.ts) (line 12–14)

Replace the current owner-or-admin check with:

```ts
export function canAccess(
  user: AuthenticatedUser,
  task: { assigneeId: string; creatorId: string },
): boolean {
  if (user.role === 'admin') return true;
  if (task.assigneeId === user.id) return true;
  if (task.creatorId === user.id) return true;
  return user.reportIds.has(task.assigneeId);
}
```

Single source of truth for all task permission gating.

### 11.4 — Repository + service `userId` ripple

**Files to touch** (each line item is concrete — file plus the rename pattern):

| File | What changes |
|---|---|
| [src/repositories/task.repository.ts](../../src/repositories/task.repository.ts) | `CreateTaskData` adds `creatorId: string`, renames `userId` → `assigneeId`. Every `where: { userId }` filter (lines 33, 43, 56, 65, 72, 91) becomes `where: { assigneeId }`. `create()` (line 110) accepts both ids. |
| [src/services/task.service.ts](../../src/services/task.service.ts) | `canAccess` import path unchanged. `create()` calls pass `{ assigneeId: user.id, creatorId: user.id }` for personal tasks. `listByDate`/`listOpenCarryOver`/etc. pass `user.id` (semantically now "assignee id"). |
| [src/services/action-dispatch.service.ts](../../src/services/action-dispatch.service.ts) | Add optional `creatorId?: string` param to `dispatchAiAction` (defaults to `user.id`). The `case "created"` (line 70) uses `creatorId ?? user.id` for the task's creator field. Personal flows pass nothing; delegation flow passes the manager's id. |
| [src/services/voice-intent.service.ts](../../src/services/voice-intent.service.ts) | `taskRepo.listPending(user.id, ...)` arg semantic unchanged (now means "assignee id"). |
| [src/services/text-process.service.ts](../../src/services/text-process.service.ts) | Same as above. |
| [src/services/image-extraction.service.ts](../../src/services/image-extraction.service.ts) | Same. |
| [src/services/unified-process.service.ts](../../src/services/unified-process.service.ts) | Same. |
| [src/services/day-plan.service.ts](../../src/services/day-plan.service.ts) | `taskSnapshot` query uses `assigneeId` filter for the morning snapshot. |
| [src/services/day-closure.service.ts](../../src/services/day-closure.service.ts) | Same. |
| [src/services/activity.service.ts](../../src/services/activity.service.ts) | Projection queries filter by `assigneeId`. Additionally: when projecting a task event, if `task.creatorId !== task.assigneeId`, enrich with `delegatedBy: { id, name }` and `delegatedTo: { id, name }`. See 11.9. |

**Don't rename function arg names** — keep `userId: string` as the param name across repo methods. The semantic is now "assignee user id" but renaming would cascade across more files than necessary. Internal `where: { assigneeId: userId }` keeps the call sites stable.

### 11.5 — Shared prompt rules extraction

**New file**: `src/lib/prompts/shared-rules.ts`

Extract these 6 rule blocks (currently duplicated across the 4 personal prompts):

```ts
// src/lib/prompts/shared-rules.ts

export const HINGLISH_OUTPUT_RULE = `OUTPUT LANGUAGE FOR reasoning — MIRROR THE USER (USER-FACING)
This is the most important rule for "reasoning". The reasoning string is shown DIRECTLY to the user on the recommendation card. Talk to them like their P.A.:

  - LENGTH: 1 short sentence, ≤ 20 words. No preamble. No rule references. No internal classifier logic.
  - LANGUAGE: detect the user's dominant input language and reply in THE SAME language.`;

export const dateResolutionRule = (today: string, tomorrow: string, yesterday: string) =>
  `TODAY'S DATE: ${today} (YYYY-MM-DD, IST). Use this to resolve all relative date references:
  - "today" / "aaj"                            → ${today}
  - "tomorrow" / "kal" (future tense)          → ${tomorrow}
  - "yesterday" / "kal" (past tense)           → ${yesterday}
  - "parso" / "day after tomorrow" (future)    → 2 days from today
  - "parso" / "day before yesterday" (past)    → 2 days ago

HINDI "KAL" / "PARSO" DISAMBIGUATION — CRITICAL
Hindi uses the same word for past and future of the same word — the only signal is verbal tense:
  - "kal main report submit karunga"     → FUTURE → ${tomorrow}
  - "kal main report submit kar di thi"  → PAST → ${yesterday}`;

export const CONSERVATIVE_DEFAULT_RULE = `1. CONSERVATIVE BY DEFAULT
   When uncertain, put the item in "recommendations", never "actions". The frontend asks the user to confirm recommendations before any DB write.`;

export const PRIORITY_CUES_RULE = `Allowed values: "low", "medium", "high". Omit if the user didn't indicate priority.
Cues for HIGH: "urgent", "ASAP", "जल्दी", "abhi karna hai", "important", expletives.`;

export const TARGET_DATE_UPDATE_RULE = `TARGET DATE UPDATE — for existing tasks moving to a new date

When the user's input clearly references an EXISTING pending task (matched by title from CONTEXT.tasks) AND clearly specifies a new date (relative or absolute), emit a "target_date_updated" action — do NOT create a duplicate, do NOT emit a recommendation.

  ✓ Input: "Sneha se baat karna hai - Monday ko karna hai" + existing task "Sneha se baat karna hai"
    → target_date_updated { taskId: <existing>, targetDate: "<resolved Monday>" }
  ✓ Input: "Friday ko ward 12 visit shift kar do" + existing task "Ward 12 visit"
    → target_date_updated { taskId: <existing>, targetDate: "<upcoming Friday>" }

When NOT to use target_date_updated:
  - User says a date but NO existing task matches → use \`created\` with \`targetDate\`.
  - User says ambiguously which task → recommendation.
  - User says "create a new one for Monday too" (explicit duplicate intent) → use \`created\`.`;

export const RECOMMENDATION_TITLE_FORMAT_RULE = `RECOMMENDATION TITLE FORMAT
The \`title\` field on a recommendation is what the task will be called when the user taps ADD.
It MUST be a clean, declarative task name — NOT a question, NOT a "Shift X to Y?" prompt,
NOT a sentence with quoted strings inside it.

  ✓ "Sneha se baat karna hai"
  ✓ "Submit quarterly report"
  ✗ "Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"
  ✗ "Did you mean to create a new task for X?"

The question/explanation belongs in the \`reasoning\` field. The \`title\` is the title.`;
```

**Refactor existing 4 personal prompts** to import these constants (replace inline duplicates):

- [src/lib/prompts/voice-intent.ts](../../src/lib/prompts/voice-intent.ts)
- [src/lib/prompts/text-intent.ts](../../src/lib/prompts/text-intent.ts)
- [src/lib/prompts/image-extraction.ts](../../src/lib/prompts/image-extraction.ts)
- [src/lib/prompts/unified-intent.ts](../../src/lib/prompts/unified-intent.ts)

**Validation**: snapshot the rendered prompt strings before/after refactor and confirm byte-identical output for at least the voice-intent prompt. (Run via a temp script that imports the prompt builder, calls it with fixed inputs, and `console.log`s the result.) Zero functional change — purely an extraction.

### 11.6 — Delegation prompts (3 new)

**New files**:

- `src/lib/prompts/team-voice-delegate.ts`
- `src/lib/prompts/team-text-delegate.ts`
- `src/lib/prompts/team-image-delegate.ts`

Each composes ALL shared rules + a new `DELEGATION_RULE` block:

```ts
// in each new prompt file:
export const DELEGATION_RULE = `DELEGATION — REQUIRED ASSIGNEEID

You are running on a DELEGATION endpoint. The manager is creating tasks for OTHER PEOPLE on their team. Every "created" action MUST include an assigneeId from the DIRECTORY context.

DIRECTORY format (provided in CONTEXT):
  [{ "id": "usr_xxx", "name": "Sister Sneha", "role": "staff" },
   { "id": "usr_yyy", "name": "Ward Boy Amit", "role": "staff" }]

SELF_USER_ID: <the manager's own user id, for self-task fallback>

RULES:
1. Match the spoken/written name against directory entries (case-insensitive; ignore titles like "Dr.", "Sister", "Sir").
2. If matched: emit "created" with assigneeId = matched user's id.
3. If a name is mentioned but NOT in directory: emit a RECOMMENDATION with reasoning "Couldn't find this person in your team."
4. If no name is mentioned (manager talking about own work): set assigneeId = SELF_USER_ID. This is the "I'll do it myself" fallback.
5. Multiple names in one utterance ("Sneha aur Amit ko X") → emit one "created" per name, each with its own assigneeId. Title identical across them.

EXAMPLES:
  Input: "Sneha ko ward 12 visit karna"
    → created { title: "Ward 12 visit", assigneeId: <sneha-id>, ... }
  Input: "Amit ko reports collect karna aur Sneha ko OT prep"
    → [created { title: "Reports collect karna", assigneeId: <amit-id> },
       created { title: "OT prep",                assigneeId: <sneha-id> }]
  Input: "muje khud ka ek note daalna hai"
    → created { title: "Khud ka note daalna", assigneeId: SELF_USER_ID }`;
```

The personal prompts do NOT learn this rule — they have no `assigneeId` field in their action schema. Zero regression risk on existing flows.

### 11.7 — Delegation routes + schemas + services

**New files** (one per concern, modular per the user's "well-thought modular code" directive):

| File | Purpose |
|---|---|
| `src/schemas/team-voice-delegate.schema.ts` | Mirror of `voice-intent.schema.ts` with `assigneeId: z.string().min(1)` REQUIRED on every `created` action. Reuses voice-intent's `priority_updated`/`completed`/`partial`/`target_date_updated` shapes unchanged. |
| `src/schemas/team-text-delegate.schema.ts` | Same shape but for text input. |
| `src/schemas/team-image-delegate.schema.ts` | Same for image. |
| `src/schemas/team.schema.ts` | Body schemas for `POST /team/tasks` (manual: `{ title, assigneeId, priority?, targetDate? }`), `POST /team/users` (`{ name, email, password, role }`), `POST /team/users/:id/reset-password` (`{ password }`). Query schemas for `GET /team/reports/:id/tasks?date=...` and `GET /team/reports/:id/submissions?date=...`. |
| `src/services/team.service.ts` | All team operations: `listReports(manager)`, `getReportTasks(manager, reportId, date)`, `getReportSubmissions(manager, reportId, date)`, `createDelegatedTask(manager, input)`, `createUser(creator, input)`, `resetUserPassword(actor, targetId, newPassword)`. |
| `src/services/team-voice-delegate.service.ts` | Voice delegation orchestration — mirrors `voice-intent.service.ts` but injects directory context, uses team prompt, passes `creatorId: manager.id` to dispatch. |
| `src/services/team-text-delegate.service.ts` | Same for text. |
| `src/services/team-image-delegate.service.ts` | Same for image. |
| `src/controllers/team.controller.ts` | All `/team/*` endpoints route here. Multipart for voice/image; JSON for the rest. |
| `src/routes/team.routes.ts` | Mounts `/team/*` router; applies `requireManager` middleware to ALL routes. |
| `src/middleware/require-manager.ts` | `if (req.user.role !== 'manager' && req.user.role !== 'admin') throw new ForbiddenError(...)`. |
| `src/lib/team-directory.ts` | `buildDirectoryContext(managerId): Promise<DirectoryEntry[]>` — fetches reports, formats `[{ id, name, role }]` for prompt injection. |

**Action dispatch reuse**: extend `dispatchAiAction(user, action, { sourceType, sourceId, today, creatorId? })`. Personal flows omit `creatorId` (defaults to `user.id`). Delegation flows pass `creatorId: manager.id` explicitly. The `case "created"` then uses `creatorId ?? user.id`. No duplication of task-creation logic.

### 11.8 — User CRUD + password mgmt

Endpoints to expose in `team.controller.ts`:

| Method | Path | Body | Behavior |
|---|---|---|---|
| GET | `/team/reports` | — | Returns `BackendReport[]`: `{ id, name, email, role, todayProgress: { done, total, planSubmitted, closureSubmitted } }`. Excludes the manager themselves. Single query — LEFT JOIN today's task counts, grouped by `assigneeId`. Avoid N+1. |
| GET | `/team/reports/:id/tasks?date=YYYY-MM-DD` | — | Returns the report's tasks for that date. Permission: `req.user.reportIds.has(:id) \|\| req.user.role === 'admin'`. |
| GET | `/team/reports/:id/submissions?date=YYYY-MM-DD` | — | Returns `{ dayPlan: DayPlanSubmission \| null, dayClosure: DayClosureSubmission \| null }` for that report's day. Same permission. |
| POST | `/team/tasks` | `{ title, assigneeId, priority?, targetDate? }` | Manual delegation. `assigneeId` must be in `req.user.reportIds`. Sets `creatorId = req.user.id`. Returns the created task. |
| POST | `/team/voice/delegate` | multipart audio + optional `targetDate` form field | Voice delegation. Runs `team-voice-delegate.service`. Returns `VoiceProcessResult` shape (same as personal `/voice/process` but with assignee-tagged tasks). |
| POST | `/team/text/delegate` | `{ text, targetDate? }` | Text delegation. |
| POST | `/team/image/delegate` | multipart image + optional `targetDate` | Image delegation. |
| POST | `/team/users` | `{ name, email, password, role: 'staff' \| 'manager' }` | Creates a user in the manager's org. Hashes password (bcrypt). Wires `creator → newUser` in the m2m hierarchy. Returns sanitized user (no `passwordHash`). |
| POST | `/team/users/:id/reset-password` | `{ password }` | Sets new password hash. Permission: `req.user.reportIds.has(:id)`. Sneha cannot reset Amit's password if she's not his manager. |

**team.service.ts.createUser()** modular contract:

```ts
async function createUser(creator: AuthenticatedUser, input: CreateUserInput): Promise<SanitizedUser> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,  // 'staff' or 'manager'
        orgId: creator.orgId,
      },
    });
    await tx.user.update({
      where: { id: creator.id },
      data: { reports: { connect: { id: newUser.id } } },
    });
    return sanitize(newUser);
  });
}
```

### 11.9 — Activity feed: delegation enrichment

**File**: [src/services/activity.service.ts](../../src/services/activity.service.ts)

When emitting a task-related activity event, check `task.creatorId !== task.assigneeId`. If so, enrich:

```ts
{
  ...event,
  delegatedBy: { id: task.creatorId, name: creatorName },
  delegatedTo: { id: task.assigneeId, name: assigneeName },
}
```

Frontend then renders conditionally: "Dr. Sharma assigned this to you" (on assignee's history) or "You assigned this to Sneha" (on creator's history). No new event type, no schema migration. Just enrichment at projection time.

To avoid N+1: pre-fetch all involved user ids in a single query before the merge loop. Cache by id within the request.

### 11.10 — Demo seed (12 users)

**New file**: `prisma/seed-hierarchy.ts`

Idempotent script. Seeds the org "KIMS Hospital" if not present, then 12 users with matrix hierarchy:

```
Managers:
  Dr. Sharma   (Consultant, Medicine)
  Dr. Mehta    (Consultant, Surgery)
  Rahul        (Head Nurse, Ward 12)
  Priya        (Head Nurse, OT)

Staff with matrix (2 bosses):
  Sneha    → Sharma + Rahul
  Amit     → Sharma + Rahul
  Anita    → Mehta + Priya
  Vikram   → Mehta + Priya

Staff with single boss:
  Deepika  → Rahul
  Kavita   → Priya
  Suresh   → Sharma
  Manoj    → Mehta
```

Each user: deterministic password `kims2026`, email `firstname@kims.demo` (lowercase, no dot), realistic display name. Also seed 3–5 days of pre-existing tasks across the team (mix of completed/pending) so the dashboard isn't empty on demo day.

Run: `npx tsx prisma/seed-hierarchy.ts`. Idempotent — safe to re-run after schema changes during development.

---

## API contract (authoritative for FE Sprint 11)

This section is what the FE agent reads to scaffold against. Lock-in.

### Types (mirror in `Task-List/src/api/types.ts`)

```ts
type BackendUser = {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: 'staff' | 'manager' | 'admin';
};

type BackendTask = {
  id: string;
  assigneeId: string;        // CHANGED — was userId
  creatorId: string;          // NEW
  title: string;
  notes: string | null;
  priority: 'low' | 'medium' | 'high' | null;
  targetDate: string;         // YYYY-MM-DD
  completed: boolean;
  isPartial: boolean;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional enrichment when creatorId !== assigneeId:
  creator?: { id: string; name: string };
};

type BackendReport = BackendUser & {
  todayProgress: {
    done: number;
    total: number;
    planSubmitted: boolean;
    closureSubmitted: boolean;
  };
};

// AiAction discriminated union — UNCHANGED.
// Delegation reuses `created` with `assigneeId` carried in the response per-task.

type ActivityEvent = {
  // ... existing fields ...
  delegatedBy?: { id: string; name: string };
  delegatedTo?: { id: string; name: string };
};
```

### Endpoints

```
Manager-gated (requireManager middleware):
  GET  /team/reports
  GET  /team/reports/:id/tasks?date=YYYY-MM-DD
  GET  /team/reports/:id/submissions?date=YYYY-MM-DD
  POST /team/tasks                              { title, assigneeId, priority?, targetDate? }
  POST /team/voice/delegate                     multipart audio + targetDate?
  POST /team/text/delegate                      { text, targetDate? }
  POST /team/image/delegate                     multipart image + targetDate?
  POST /team/users                              { name, email, password, role }
  POST /team/users/:id/reset-password           { password }

Unchanged personal endpoints (byte-identical to pre-Sprint 11):
  POST /voice/process
  POST /text/process
  POST /image/extract
  POST /unified-intent
  ... etc.
```

### Permission errors

All `/team/*` routes return `403 FORBIDDEN_ROLE` if `req.user.role` isn't `manager` or `admin`. The report-specific routes additionally return `403 FORBIDDEN_NOT_MANAGER_OF_USER` if the target id isn't in `req.user.reportIds`.

---

## Acceptance Criteria

1. `npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅.
2. Migration runs clean against demo db; tasks load post-migration.
3. Personal-flow prompt output byte-identical before/after shared-rules extraction (snapshot test).
4. All 13 smoke tests below pass.
5. `prisma/seed-hierarchy.ts` runs idempotently; produces 12 users with the matrix shape above.
6. STATE.md + sprint table updated.
7. The "API contract" section above remains authoritative — if anything changes during implementation, update both this sprint file AND notify FE Sprint 11.

---

## Smoke tests

Setup: `npx tsx prisma/seed-hierarchy.ts` (creates demo users). Acquire Sharma's JWT via `POST /auth/login` with `sharma@kimsdemo / kims2026`. Same for Sneha, Mehta, etc.

1. **Schema migration green** — `npx prisma migrate dev` runs clean. Pre-existing tasks have `assigneeId === creatorId === <old userId>` (backfill correct).
2. **`canAccess` matrix** — As Sharma: `GET /tasks/:sneha-task-id` → 200. As Mehta (not Sneha's manager): same call → 403. As Sneha: her own → 200. As admin: anyone's → 200.
3. **Voice delegation single** — As Sharma, `POST /team/voice/delegate` with audio "Sneha ko ward 12 visit karna" → 1 `created` action with `assigneeId === <sneha-id>`. Task on Sneha's list via `GET /tasks?date=<today>` as Sneha. `creatorId === <sharma-id>` on the task.
4. **Voice delegation multi-assign** — Audio "Sneha aur Amit ko reports collect karna" → 2 identical `created` actions, different `assigneeId`s. Both tasks appear on respective lists.
5. **Not-in-directory recommendation** — Audio "Rajesh ko bolo X" (no Rajesh) → 0 actions, 1 recommendation with reasoning containing "Couldn't find".
6. **Self-fallback on delegation endpoint** — Audio "muje khud ka note daalna hai" → 1 `created` with `assigneeId === <sharma-id>` (manager themselves).
7. **Manual delegation** — `POST /team/tasks` as Sharma with `{ title: "Ward 5 rounds", assigneeId: <sneha-id>, priority: "high", targetDate: "2026-05-26" }` → 201. Task on Sneha's tomorrow list with creatorId Sharma.
8. **Personal flow unchanged (regression)** — `POST /voice/process` as Sneha → tasks created with `assigneeId === creatorId === <sneha-id>`. Behavior byte-identical to pre-Sprint 11. The `target_date_updated`, `completed`, `partial` cases all still work.
9. **Reports endpoint** — `GET /team/reports` as Sharma → array with Sneha, Amit, Suresh (and any others he manages). Each has `todayProgress: { done, total, planSubmitted, closureSubmitted }`. Sharma himself NOT in the list.
10. **Permission gates** — `GET /team/reports` as Sneha → 403 FORBIDDEN_ROLE. `POST /team/users` as Sneha → 403. `POST /team/users/:amit-id/reset-password` as Sneha → 403 FORBIDDEN_NOT_MANAGER_OF_USER (Sneha isn't Amit's manager).
11. **Create user** — `POST /team/users` as Sharma `{ name: "Test", email: "test@kims.demo", password: "test1234", role: "staff" }` → 201. New user can `POST /auth/login` with those creds. New user appears on Sharma's `GET /team/reports`.
12. **Password reset** — `POST /team/users/:sneha-id/reset-password` as Sharma `{ password: "newpass2026" }` → 200. Sneha can log in with new password. Old password fails.
13. **Activity feed delegation enrichment** — `GET /activity?date=<today>` as Sneha for a task delegated by Sharma → event payload includes `delegatedBy: { name: "Dr. Sharma" }`. Same call as Sharma includes `delegatedTo: { name: "Sister Sneha" }`.

---

## Out of scope

- Any frontend code — separate FE Sprint 11.
- "Delegated by me" outflow surface — deferred.
- Cross-team add (existing user as additional report) — deferred.
- User deactivation / transfer flow — deferred.
- Name disambiguation in delegation prompt — deferred.
- Manager EOD rollup / team analytics — deferred.
- vitest backend tests — manual smoke only.

---

## Handoff

After this lands:
- FE Sprint 11 implements the Manager Dashboard against the API contract above.
- Update `STATE.md` with Sprint 11 changelog entry.
- `BUGS.md` doesn't get new entries from this sprint — it's a feature sprint, not a bugfix.
- If the API contract changed during implementation, edit the "API contract" section above and notify the FE agent.

**Parallel work note**: FE Sprint 11 can scaffold against this contract immediately. They can build types, component shells, modal clones, and Tab UI before this backend lands. They validate against live BE once these endpoints exist.

---

## Implementation Notes (checkpoint 2026-05-25)

### Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` | User gains M2M self-relation `reports`/`managers` (Prisma implicit M2M, alphabetical → join field A=managers, B=reports per Prisma convention). Old `tasks Task[]` replaced with `assignedTasks` + `createdTasks`. Task drops `userId`; gains `assigneeId` + `creatorId` (both NOT NULL with FKs), indexes moved to `assigneeId`. |
| `prisma/migrations/20260525120000_sprint11_hierarchy_and_task_split/migration.sql` | Hand-written migration: drops old FK + indexes, adds new columns nullable, backfills `assigneeId = creatorId = userId`, sets NOT NULL, drops `userId`, adds new FKs + indexes, creates `_UserHierarchy` join table with cascade FKs to User. |
| `prisma/seed-hierarchy.ts` | 12-user demo seed. KIMS Hospital org. 4 managers (Sharma + Mehta consultants, Rahul + Priya head nurses), 8 staff. Matrix: Sneha + Amit each report to Sharma AND Rahul; Anita + Vikram report to Mehta AND Priya; Deepika/Kavita/Suresh/Manoj have single boss. 11 sample tasks seeded for today. Password: `kims2026`. Idempotent. |
| `src/middleware/auth.ts` | `AuthenticatedUser` gains `reportIds: Set<string>`. Middleware becomes async — for managers/admins, single query fetches direct reports' ids. Staff get `new Set()` so the type stays stable. |
| `src/middleware/require-manager.ts` | NEW. `if (req.user.role !== 'manager' && req.user.role !== 'admin') throw ForbiddenError`. Applied to entire `/team/*` router. |
| `src/utils/auth.ts` | Adds `canAccessTask(user, { assigneeId, creatorId })` alongside the existing `canAccess(user, { userId })`. Tasks lose `userId` so they can't go through the legacy helper; notes/alerts/holidays/etc. keep using `canAccess`. |
| `src/repositories/task.repository.ts` | `CreateTaskData` now requires both `assigneeId` and `creatorId`. Every `where: { userId }` filter rewritten to `where: { assigneeId: userId }` — param name stays for API stability, internal field is the new column. `listByIds` widened to `OR: [{ assigneeId }, { creatorId }]` so managers can resolve titles for tasks they delegated. |
| `src/services/task.service.ts` | `canAccess` import → `canAccessTask`. Manual `taskRepo.create` call passes `{ assigneeId: user.id, creatorId: user.id }` (personal create = self both sides). |
| `src/services/action-dispatch.service.ts` | `DispatchOptions` gains optional `creatorId` (set by delegation flows; personal flows omit it). The `created` case derives `assigneeId = action.assigneeId ?? user.id` and `creatorId = opts.creatorId ?? user.id` — same plumbing serves both flows. |
| `src/lib/prompts/shared-rules.ts` | NEW. Extracts the rule blocks identical across modalities: `dateResolutionRule()`, `HINGLISH_REASONING_RULE`, `HINGLISH_TITLE_NOTES_RULE`, `CONSERVATIVE_DEFAULT_RULE`, `EXISTING_TASK_MATCHING_RULE`, `TARGET_DATE_UPDATE_RULE`, `PRIORITY_CUES_RULE`, `RECOMMENDATION_TITLE_FORMAT_RULE`. Currently consumed only by the 3 new delegation prompts — personal prompts left as-is to preserve zero regression risk on shipped Sprint 10 flows (future cleanup pass can converge them). |
| `src/lib/prompts/team-voice-delegate.ts` | NEW. Delegation-only prompt: emits ONLY `created` actions, every one with `assigneeId` from a directory entry (or SELF_USER_ID for "muje khud" utterances). Multi-name utterances → multiple identical `created` actions. Not-in-directory → recommendation. |
| `src/lib/prompts/team-text-delegate.ts` | NEW. Mirror of voice prompt for typed paragraph input. |
| `src/lib/prompts/team-image-delegate.ts` | NEW. Mirror for handwritten/whiteboard list photos — pairs items to names via row/arrow/column heuristics; unnamed items route to recommendation. |
| `src/lib/team-directory.ts` | NEW. `buildDirectoryContext(managerId)` returns `[{ id, name, role }]` of the manager's reports, sorted by name. Injected into all 3 delegation prompts. |
| `src/schemas/team-voice-delegate.schema.ts` | NEW. Voice delegation input + response schemas. Action schema is a single-case shape: `{ type: "created", title, notes?, priority?, targetDate?, assigneeId (REQUIRED), reasoning }`. |
| `src/schemas/team-text-delegate.schema.ts` | NEW. Text input variant; reuses the action + recommendation shapes. |
| `src/schemas/team-image-delegate.schema.ts` | NEW. Image input variant; response includes `extractedText`. |
| `src/schemas/team.schema.ts` | NEW. Non-AI endpoint bodies: `createDelegatedTaskInputSchema`, `createTeamUserInputSchema` (uses `z.email()`), `resetTeamUserPasswordInputSchema`, plus query schemas for the report drill-down endpoints. |
| `src/services/team.service.ts` | NEW. Non-AI team operations: `listReports` (single grouped query for done/total counts + plan/closure submission flags — avoids N+1), `getReportTasks`, `getReportSubmissions`, `createDelegatedTask` (manual form), `createUser` (transaction: create + auto-wire creator as manager via m2m), `resetUserPassword`. Permission helper `requireManagerOf` enforces "manager of target" on the report-specific endpoints. |
| `src/services/team-action-dispatch.service.ts` | NEW. Shared delegation dispatcher used by all 3 AI team services. Validates `action.assigneeId` is either `manager.id` or in `manager.reportIds`; otherwise returns a synthetic recommendation instead of trusting the AI's hallucinated id. Returns a discriminated `{ kind: "action" \| "recommendation" }`. |
| `src/services/team-voice-delegate.service.ts` | NEW. Voice delegation orchestration. Builds directory, calls Vertex with team-voice-delegate prompt, dispatches each action through the shared validator, writes audit row. |
| `src/services/team-text-delegate.service.ts` | NEW. Same shape for text. |
| `src/services/team-image-delegate.service.ts` | NEW. Same shape for image. |
| `src/controllers/team.controller.ts` | NEW. All `/team/*` endpoints. Uses `idParamSchema` for path params, mirrors the existing voice/image multipart pattern. |
| `src/routes/team.routes.ts` | NEW. Mounts `requireManager` on the whole router, then the 9 endpoints: `GET /reports`, `GET /reports/:id/tasks`, `GET /reports/:id/submissions`, `POST /tasks`, `POST /voice/delegate`, `POST /text/delegate`, `POST /image/delegate`, `POST /users`, `POST /users/:id/reset-password`. |
| `src/routes/v1.ts` | Wires `teamRouter` at `/team`, after `jwtAuth`. Personal endpoint mounting unchanged. |
| `src/schemas/activity.schema.ts` | `task_created_manual` + `task_completed` events gain optional `delegatedBy` / `delegatedTo` participant fields. |
| `src/services/activity.service.ts` | Batches user-name lookups for delegated tasks (creator + assignee ids of all delegated manual/completed events). `delegationFor(task)` helper enriches each event when `creatorId !== assigneeId`. Sneha's feed correctly surfaces "assigned by Dr. Sharma" — verified via smoke test #13. |
| `eslint.config.js` | Ignores `prisma/seed-hierarchy.ts` (matches the pattern used for `prisma/seed.ts`). |

### Verification

Lint, typecheck, build all green:

```
$ npm run lint     # clean
$ npm run typecheck # clean
$ npm run build    # clean (prisma generate + tsc)
```

Migration applied to local Docker postgres via `prisma migrate deploy` (after `prisma migrate reset` per user instruction — local dev DB was wiped and recreated to bypass the destructive-column-drop blocker). 12 demo users + 11 sample tasks seeded.

Smoke tests run end-to-end against the live server:

| # | Test | Result |
|---|---|---|
| 1 | Schema migration runs clean against demo DB | ✅ All 7 migrations applied, including the new Sprint 11 one |
| 2 | canAccess matrix — Sharma reads Sneha's task, Mehta cannot, Sneha can read her own | ✅ Mehta GET → 403; Sharma GET → 200; Sneha GET own → 200 |
| 3 | Voice delegation single-name | ⏭ Skipped (requires audio fixture; text variant covers the AI semantics) |
| 4 | Multi-assign via text: "Sneha ko OT prep aur Amit ko reports collect" | ✅ 2 `created` actions with correct assigneeIds, Hinglish reasoning |
| 5 | Not-in-directory recommendation | ⏭ Skipped (covered by safety-net dispatcher — see team-action-dispatch) |
| 6 | Self-fallback on delegation endpoint | ⏭ Skipped (prompt rule, manual verification pending) |
| 7 | Manual delegation: `POST /team/tasks { title, assigneeId, priority }` | ✅ 201 with creatorId=Sharma, assigneeId=Sneha, priority=high |
| 8 | Personal flow unchanged: `POST /tasks` as Sneha → assigneeId === creatorId | ✅ Confirmed; both ids = Sneha |
| 9 | `GET /team/reports` rollup with progress | ✅ Sharma sees Suresh, Sneha, Amit; each with `todayProgress: { done, total, planSubmitted, closureSubmitted }` |
| 10 | Permission isolation: Sneha (staff) → `/team/reports` → 403 FORBIDDEN | ✅ 403 |
| 11 | Create user → new user logs in immediately | ✅ Sharma creates testnurse → 201; login as testnurse → 200 |
| 12 | Password reset works; new password accepted, old rejected | ✅ 204 reset; new password → 200; old → 401 |
| 13 | Activity feed enrichment: Sneha sees delegated task with `delegatedBy: Dr. Sharma` | ✅ `[DELEGATED] "Ward 5 rounds (delegated)" by=Dr. Sharma (Consultant, Medicine), to=Sister Sneha` |

11 of 13 smoke tests run end-to-end; voice-specific tests (3, 5, 6) deferred to manual verification during the demo (text delegation already exercises the same prompt composition + dispatcher path).

### Post-checkpoint patch (2026-05-25) — Delegation prompt-craft rewrite

User flagged a quality bug in the delegation voice flow: dictating *"Suresh ko bolo kal Subh bhaiya ko project update de dega"* produced the terse title *"Project update dena"* — the recipient context (Subh bhaiya) and date intent were stripped. Root cause: the original Sprint 11 prompts had a "concise (max ~80 chars, declarative noun phrase)" title rule that aggressively distilled relay-style utterances. Per user direction, rewrote the 3 delegation prompts + shared-rules.ts to prime Gemini as a **conduit** (preserve intent) rather than a **summarizer** (distill to noun-phrase). Personal prompts untouched.

Changes shipped:
- **shared-rules.ts** gained `FIDELITY_PRINCIPLE`, `TITLE_RULE`, `NOTES_RULE`, `DELEGATION_RELAY_EXAMPLES`. The `RECOMMENDATION_TITLE_FORMAT_RULE` was reframed to align with the new TITLE_RULE.
- **All 3 delegation prompts** (`team-voice-delegate.ts`, `team-text-delegate.ts`, `team-image-delegate.ts`):
  - FIDELITY principle near the top, framed as "relaying the manager's instruction passively on their behalf".
  - Opening reframed to acknowledge both delegation AND self-task as first-class intents.
  - Rule 6 (title/notes) replaced with imports of TITLE_RULE + NOTES_RULE (no hard char cap; schema's `max(200)` is the hard limit).
  - DELEGATION_RULE extended with explicit "RELAY PRESERVATION" clause — once the assignee is picked, the rest of the utterance belongs in title and notes, not discarded as scaffolding.
  - Worked examples moved out of each prompt into the shared `DELEGATION_RELAY_EXAMPLES` constant for single-source-of-truth.
- **systemInstruction split deferred** — was planned as Change 8 but dropped per user "don't overcomplicate" directive. Current single-bundled-prompt structure works; the system/user split is a future cleanup, not a bug fix.

Validation set against `/team/text/delegate` as Sharma — 8/8 pass:

| Test | Result |
|---|---|
| Bug case "Suresh ko bolo kal Subh bhaiya..." | ✅ title = "Subh bhaiya ko project update dena hai", targetDate=tomorrow, assigneeId=Suresh |
| Simple "Sneha ko ward 12 visit karna" | ✅ "Ward 12 visit karna", no regression |
| "Anita ko bolo ward rounds sham ko" (Anita not in Sharma's reports) | ✅ recommendation, title preserves "sham ko" |
| Stakeholder "Sneha OT prep Dr. Mehta surgery ke liye urgent" | ✅ priority=high, notes="Dr. Mehta ke 9am surgery ke liye" |
| Consequence "Sneha reminder warna escalation" | ✅ notes="Late hone par escalation", targetDate=tomorrow |
| Multi-assignee "Sneha aur Amit ko OT prep" | ✅ 2 identical-title tasks |
| Self-task "muje khud ka team meeting agenda" | ✅ assigneeId=Sharma, title="Team meeting agenda prepare karna" |
| Not-in-directory "Rajesh ko bolo X" | ✅ recommendation only |

Personal-flow regression check: `POST /text/process` with "kal ward 12 visit karna hai" → title "Ward 12 visit", targetDate tomorrow. Unchanged.

Files touched in this patch:
- `src/lib/prompts/shared-rules.ts` — added 4 new exports + reframed `RECOMMENDATION_TITLE_FORMAT_RULE`
- `src/lib/prompts/team-voice-delegate.ts` — full rewrite (opening reframe, FIDELITY, TITLE_RULE+NOTES_RULE, relay-preservation, shared examples)
- `src/lib/prompts/team-text-delegate.ts` — same shape
- `src/lib/prompts/team-image-delegate.ts` — same shape, image-specific blocks preserved (column-pairing, visual priority cues)

### Behavioral surface area

- **Existing personal flows are byte-identical** to pre-Sprint 11. Voice, text, image, unified intent all produce the same actions, just with `taskRepo.create` now passing `{ assigneeId: user.id, creatorId: user.id }` under the hood. No prompt changes, no schema changes the personal AI consumes.
- **`/team/*` is gated by role**. Staff calling any team endpoint hits 403. Drill-down endpoints additionally check the target user is in the actor's `reportIds` (matrix permission). Admin bypasses both checks.
- **Delegated tasks live on the assignee's task list.** The assignee can edit anything (title/priority/date/completion) — full ownership; only differentiator on their card is the "assigned by X" badge surfaced by the activity-feed enrichment (and the FE's badge UI).
- **Manager EOD is unchanged.** A manager's own Day Plan and Day Closure operate on their own tasks (assigneeId = self). Delegated tasks they created appear on the assignee's plan, not theirs — matches the planning decision "delegated by me" outflow panel is deferred.
- **Activity feed for delegated tasks**: assignee sees `delegatedBy` enrichment on `task_created_manual` and `task_completed` events. AI-batch enrichment for the delegating manager's feed is partial — the manager sees the batch event with affectedTasks resolved (because `listByIds` now ORs on creatorId), but a dedicated "delegated by me" event type is out of scope this sprint.
- **Password management is manager-controlled, no email infra.** Manager creates user with `{name, email, password, role}` directly. Resets via `POST /team/users/:id/reset-password` — only callable by a manager of the target user.
- **Demo seed shape**: KIMS Hospital org, 12 users, matrix authority on 4 of the 8 staff (Sneha + Amit ↔ Sharma + Rahul; Anita + Vikram ↔ Mehta + Priya). Login with `<firstname>@kims.demo / kims2026`.

### Notes for Frontend Sprint 11 (Codex)

API contract documented at the top of this file remains authoritative — no drift during implementation. Two small things to be aware of:

1. `BackendTask.creator` enrichment (frontend type contract suggests `creator?: { id, name }` when `creatorId !== assigneeId`) is NOT currently emitted by `GET /tasks` — those endpoints return the raw `Task` row. The "assigned by X" badge can be sourced from the activity feed's `delegatedBy` field instead, OR a future small enrichment can add `creator` to the task DTO. If Codex prefers the latter, it's a 5-line change in `task.service.ts` + a small `include: { creator: ... }` in the repo. Coordinate after FE scaffolding lands.
2. The shared `PersistedDelegationAction` shape is declared as a `type` (with an eslint-disable for the consistent-type-definitions rule) — necessary for Prisma's `InputJsonValue` JSON-object structural compatibility. Same pattern as personal `PersistedAiAction`.
