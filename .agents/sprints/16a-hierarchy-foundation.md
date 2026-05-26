---
id: SPRINT-BE-16A
title: Hospital Hierarchy Foundation — Schema, Seed, Scope Resolver
status: ready for review
date: 2026-05-26
tags: [sprint, backend, hierarchy, schema, seed, scope, foundation]
related: [STATE, BE-SPRINT-16B, FE-SPRINT-16C, FE-SPRINT-16D, BE-SPRINT-11, BE-SPRINT-14]
parallel_with: Task-List/.agents/sprints/16c-dashboard-design-system.md
owner: claude-session
estimated_effort: 1.5 days
---

# Backend Sprint 16A — Hospital Hierarchy Foundation

## Mission

You are landing the **schema bones** that the Sprint 16 dashboard sits on. This sprint produces no UI and no user-visible behavior beyond seed data. But every endpoint in Sprint 16B and every panel in Sprint 16D depends on the models, seed, and `resolveScope()` helper you ship here being correct, performant, and *true to the hospital reality the founder wants to sell to KIMS-tier hospital CXOs*.

The single most important property of this sprint: **the migration must land cleanly once, never need a follow-up, and not retract anything from Sprint 11's M2M matrix authority.** Schema is expensive to change later; spend the extra hour now to get the indexes and PK shapes right.

---

## Required reading before you write any code

Read in order. Do not skim — every later decision references these.

1. **[d:/gig_project/SPRINT16_DASHBOARD_DECISION_LOG.md](d:/gig_project/SPRINT16_DASHBOARD_DECISION_LOG.md)** — the strategic decision log written with the founder. Sections 1-4 (background), section 6 (scaling model), section 7 (D1-D14), section 10 (schema delta), section 12 (resolveScope). Skim sections 11/13 since those are Sprint 16B/C concerns.
2. **`C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md`** — the planning round's gotcha audit + sprint split. Pay attention to **L1-L9** at the top (the locked decisions that override parts of the source doc).
3. **[Backend_task_list/prisma/schema.prisma](Backend_task_list/prisma/schema.prisma)** — the current schema. Note `User`, `Task`, `DayPlanSubmission`, `DayClosureSubmission`, and the `_UserHierarchy` M2M (which you preserve verbatim).
4. **[Backend_task_list/prisma/seed-hierarchy.ts](Backend_task_list/prisma/seed-hierarchy.ts)** — the existing 12-user KIMS seed. Lines 50-63 define the matrix-manager mapping. Your seed expansion is **additive** on top of this — never delete.
5. **[Backend_task_list/src/middleware/auth.ts](Backend_task_list/src/middleware/auth.ts)** — the `AuthenticatedUser` interface and how `reportIds: Set<string>` is precomputed. You'll extend this same middleware later but not in this sprint.
6. **[Backend_task_list/src/utils/auth.ts](Backend_task_list/src/utils/auth.ts)** — the existing `canAccessTask`. You add one clause to it; don't refactor it.
7. **[Backend_task_list/src/middleware/require-manager.ts](Backend_task_list/src/middleware/require-manager.ts)** — confirm the gate semantics. Don't touch it.

If anything in those documents contradicts this sprint, **this sprint wins** — but raise the contradiction in your end-of-sprint handoff note.

---

## Locked decisions you inherit (do not re-litigate)

| # | Rule | Source |
|---|---|---|
| L1 | Keep `_UserHierarchy` M2M intact. No 1:1 `managerId`. Sneha → Sharma AND Rahul stays. | D1, planning round |
| L2 | Replace D12's per-submission `reviewedAt/reviewedBy` columns with a join table `SubmissionReview(submissionId, submissionKind, reviewerId, reviewedAt)`. Per-manager review state. | Planning round (G2 fix) |
| L3 | `Task.groupId` is **optional override metadata only**. Dashboard rollups (Sprint 16B) JOIN on `GroupMembership`, not on `Task.groupId`. AI delegation continues to leave it `null` — do NOT add inference logic. | Planning round (G3 fix) |
| D5 | `GroupMembership` has only `isLead: Boolean` + `canManage: Boolean`. No more capability fields. | Source doc D5 |
| D6 | Personal-Directs is **lazy auto-provisioned**, not in seed. Sprint 16B writes the provisioner; you DO NOT create Personal-Directs groups in seed. | Source doc D6 |
| D10 | `User.level` is an `Int` column, populated from role: `staff=100`, `manager=400`, `admin=800`. The dept-head reservation (600) from the source doc is DROPPED — dept-head is just a manager whose id appears in `Department.headId`. | Source doc D10, modified by planning round G7 |
| D11 | `GroupMembership` PK = `[userId, groupId, validFrom]`. Temporal from day one. `validTo` nullable; null = currently active. | Source doc D11 |

Anything not in the above table that contradicts a "✓ locked" decision in the source doc — preserve.

---

## Scope — what ships

### In scope

1. **One Prisma migration** containing every schema delta listed below. One file, no follow-ups.
2. **Seed expansion** ([Backend_task_list/prisma/seed-hierarchy.ts](Backend_task_list/prisma/seed-hierarchy.ts)) — additive: 6 new users, 5 departments, 6-8 context groups, ~150 group memberships, 8 days of backdated task + submission history with deliberate consistency gaps.
3. **`resolveScope(user)` helper** — single function, single source of truth, used by every Sprint 16B endpoint.
4. **`canAccessTask` extension** — add one OR-clause: "actor `isLead=true` on any active group containing the task's assignee".
5. **`User.level` populated** at seed time from role.

### Out of scope (do NOT build in this sprint)

- Any `/dashboard/*` endpoints (that's Sprint 16B)
- AI Morning Brief logic (Sprint 16B)
- Submission review endpoints (Sprint 16B uses the table you create here, but the endpoints are 16B's)
- Personal-Directs provisioner service (Sprint 16B)
- Department / Group / Membership CRUD endpoints (Sprint 16B)
- `requireSuperiorLevel` middleware (deferred to F3)
- Anything touching personal `/voice/process`, `/text/process`, `/images/process`, `/process`, `/team/voice/delegate`, etc.

If you find yourself reaching for Vertex AI or Express route files, you have left scope. Stop and reread this section.

---

## Phase 1 — Schema migration

### Files to modify

- [Backend_task_list/prisma/schema.prisma](Backend_task_list/prisma/schema.prisma) — schema edits
- New file: `Backend_task_list/prisma/migrations/<timestamp>_add_hierarchy_foundation/migration.sql` — auto-generated via `npx prisma migrate dev --name add_hierarchy_foundation`

### New models

```prisma
model Department {
  id        String   @id @default(cuid())
  orgId     String
  name      String
  headId    String?
  createdAt DateTime @default(now())

  head   User?          @relation("DepartmentHeads", fields: [headId], references: [id])
  groups ContextGroup[]

  @@index([orgId])
}

model ContextGroup {
  id           String   @id @default(cuid())
  orgId        String
  departmentId String?
  name         String
  /// 'ward' | 'ot' | 'shift' | 'project' | 'personal'
  /// 'personal' is reserved for the Personal-Directs lazy auto-provision in Sprint 16B.
  /// Sprint 16B endpoints filter `kind: "personal"` out of the public group grid.
  kind         String   @default("ward")
  createdAt    DateTime @default(now())

  department  Department?       @relation(fields: [departmentId], references: [id])
  memberships GroupMembership[]
  tasks       Task[]

  @@index([orgId])
  @@index([departmentId])
}

model GroupMembership {
  userId    String
  groupId   String
  isLead    Boolean   @default(false)
  canManage Boolean   @default(false)
  validFrom DateTime  @default(now())
  validTo   DateTime?
  reason    String?

  user  User         @relation(fields: [userId], references: [id])
  group ContextGroup @relation(fields: [groupId], references: [id])

  @@id([userId, groupId, validFrom])
  @@index([groupId, validTo])
  @@index([userId, validTo])
}

/// L2: matrix-aware submission review state. One row per (submission, manager).
/// `submissionKind` is "plan" | "closure" — discriminator over the two submission tables.
model SubmissionReview {
  submissionId   String
  submissionKind String   // 'plan' | 'closure'
  reviewerId     String
  reviewedAt     DateTime @default(now())

  reviewer User @relation("SubmissionReviewer", fields: [reviewerId], references: [id])

  @@id([submissionId, submissionKind, reviewerId])
  @@index([reviewerId, reviewedAt])
}

/// Demo stub for Sprint 16D's "Send Reminder" button. No actual delivery.
model ReminderIntent {
  id           String   @id @default(cuid())
  targetUserId String
  /// 'plan' | 'closure'
  kind         String
  sentAt       DateTime @default(now())
  sentBy       String

  target User @relation("ReminderTarget", fields: [targetUserId], references: [id])
  sender User @relation("ReminderSender", fields: [sentBy], references: [id])

  @@index([targetUserId, sentAt])
}
```

### Modified models

```prisma
model User {
  // ... existing fields preserved verbatim ...
  level Int @default(100)

  memberships         GroupMembership[]
  departmentsHeaded   Department[]        @relation("DepartmentHeads")
  submissionReviews   SubmissionReview[]  @relation("SubmissionReviewer")
  remindersReceived   ReminderIntent[]    @relation("ReminderTarget")
  remindersSent       ReminderIntent[]    @relation("ReminderSender")

  // _UserHierarchy M2M relations stay EXACTLY as they are. Do not touch.
}

model Task {
  // ... existing fields preserved verbatim ...
  groupId String?
  group   ContextGroup? @relation(fields: [groupId], references: [id])

  @@index([groupId, targetDate])
  // Existing indexes stay.
}

// DayPlanSubmission and DayClosureSubmission are NOT modified.
// Review state lives in SubmissionReview, not on the submission row itself.
```

### Migration hygiene

- Run `npx prisma migrate dev --name add_hierarchy_foundation`. Verify the generated SQL is **purely additive** — no DROP, no ALTER on existing not-null columns.
- The migration must run cleanly on a fresh DB (`prisma migrate reset`) AND on top of the existing demo data without rewriting anything.
- After migration: `npx prisma generate` to refresh the client. Verify Prisma client typings now include `Department`, `ContextGroup`, `GroupMembership`, `SubmissionReview`, `ReminderIntent`.

---

## Phase 2 — Seed expansion

### File to modify

[Backend_task_list/prisma/seed-hierarchy.ts](Backend_task_list/prisma/seed-hierarchy.ts) — additive. Existing 12 users + their `_UserHierarchy` edges remain untouched.

### New users (6)

All under `orgId = "kims-hospital"`. Password for all: `kims2026`. Use bcrypt hash via existing utilities — do not invent a new hash path.

| Email | Name | Role | Designation (for display) | level |
|---|---|---|---|---|
| `iyer@kims.demo` | Dr. Iyer | `admin` | Medical Director | 800 |
| `krishnan@kims.demo` | Dr. Krishnan | `manager` | Operations HOD | 400 |
| `reddy@kims.demo` | Ms. Reddy | `manager` | GRE Head / Front Office Manager | 400 |
| `ravi@kims.demo` | Ravi | `staff` | Operations Attendant | 100 |
| `geeta@kims.demo` | Geeta | `staff` | Housekeeping Lead | 100 |
| `anjali@kims.demo` | Anjali | `staff` | GRE Front Desk | 100 |
| `pooja@kims.demo` | Pooja | `staff` | IPD Coordinator | 100 |

Wait — that's 7. Trim: drop `geeta` to keep it at 6 OR keep all 7. **Pick 6** (drop Geeta to stay at 6 new users; Ravi alone is enough for Ops staff).

### Hierarchy edges (`_UserHierarchy`)

New edges, additive:
- Krishnan manages: Ravi
- Reddy manages: Anjali, Pooja
- Iyer (admin) needs no explicit manager edges — admin role scope = org-wide

### Set User.level for existing 12 users
Backfill in seed:
- `sharma`, `mehta`, `rahul`, `priya` → `level = 400`
- all 8 staff → `level = 100`

### Departments (5)

| Name | headId | Notes |
|---|---|---|
| Medicine | `sharma.id` | |
| Surgery | `mehta.id` | |
| Nursing | `rahul.id` | Rahul is both Nursing HOD AND a Ward 12 group lead — that's intentional |
| Operations | `krishnan.id` | |
| GRE | `reddy.id` | |

### ContextGroups (7 — pick names that read well in the dashboard)

| Name | kind | departmentId | Lead |
|---|---|---|---|
| Ward 12 — General Medicine | `ward` | Medicine | Rahul (also Ward 12 lead, isLead=true) |
| ICU-A — Critical Care | `ward` | Medicine | Sharma (isLead=true on this one specifically) |
| OT-2 — Ortho | `ot` | Surgery | Priya (isLead=true) |
| Night Shift — Ward 12 | `shift` | Nursing | Rahul (also leads this) |
| OT Nursing Pool | `ot` | Nursing | Priya |
| GRE Front Desk | `project` | GRE | Reddy |
| Ops Maintenance | `project` | Operations | Krishnan |

### GroupMembership seeding

Rule: every user has at least one active membership (`validTo = null`). Use these patterns:

- **Sharma**: ICU-A (isLead+canManage), Ward 12 (member)
- **Mehta**: OT-2 (member — Priya leads); add him as canManage so dept-head bypass demos
- **Rahul**: Ward 12 (isLead+canManage), Night Shift (isLead+canManage)
- **Priya**: OT-2 (isLead+canManage), OT Nursing Pool (isLead+canManage)
- **Krishnan**: Ops Maintenance (isLead+canManage)
- **Reddy**: GRE Front Desk (isLead+canManage)
- **Sneha**: Ward 12 (member), Night Shift (member) — *intentional cross-group; proves the model*
- **Amit**: Ward 12 (member)
- **Anita**: OT-2 (member), OT Nursing Pool (member)
- **Vikram**: OT-2 (member)
- **Deepika**: Ward 12 (member)
- **Kavita**: OT Nursing Pool (member)
- **Suresh**: ICU-A (member)
- **Manoj**: OT-2 (member)
- **Ravi**: Ops Maintenance (member)
- **Anjali**: GRE Front Desk (member)
- **Pooja**: GRE Front Desk (member)

`validFrom` for every membership: `new Date('2026-05-15')` (10 days before "today" in demo time). `validTo`: null.

### Historical backdated data (8 days)

For each of the last 8 calendar days (today - 8 → yesterday), seed for every active staff/manager user:

- **Tasks**: 3-6 random tasks per user per day with `targetDate` = that day. Mix completed/partial/open at roughly 70/15/15. `sourceType` = mix of `"manual"`, `"voice"`, `"text"`.
- **DayPlanSubmission**: one row per (user, date) **with deliberate gaps**:
  - **Sneha**: missing on `today-2` and `today-4`
  - **Amit**: missing on `today-3`
  - **Anita**: present every day (top performer signal)
  - **Suresh**: missing on `today-5`
  - **Others**: present every day
- **DayClosureSubmission**: similar pattern, but more sparse:
  - **Amit**: missing on `today-3`, `today-6`
  - **Vikram**: missing on `today-1`, `today-3`
  - **Manoj**: missing on `today-4`
  - **Pooja**: missing on `today-2`
  - **Others**: present every day
- **VoiceInteraction / TextInteraction / ImageExtraction**: ~5-8 backdated AI interactions distributed across managers across the 8 days so the activity feed has visible items per day.
- **Meeting**: 2-3 meetings backdated, one per day for the last 3 days, with `processedAt` set so `meeting_processed` events surface in History.

**Critical:** these gaps are the data signal for §5.4 People-to-watch in Sprint 16D. If you seed everyone with 100% submission, that panel renders empty and the demo collapses.

### Idempotency

The seed must be idempotent — running it twice should not duplicate rows. Use `upsert` keyed on stable values (email for users, `[name, orgId]` for departments, etc.).

---

## Phase 3 — `resolveScope` + permission helpers

### New file: `Backend_task_list/src/lib/resolve-scope.ts`

```ts
import type { AuthenticatedUser } from "../middleware/auth.js";
import prisma from "./prisma.js";

export type Scope =
  | { type: "org"; orgId: string }
  | { type: "dept"; departmentIds: string[]; orgId: string }
  | { type: "group"; groupIds: string[]; orgId: string }
  | { type: "reports-only"; reportIds: string[]; orgId: string }
  | { type: "none" };

/**
 * Resolves the visibility scope of the calling user. Used by every
 * /dashboard/* endpoint in Sprint 16B. Single source of truth.
 *
 * Resolution order (first match wins):
 *   1. admin → org-wide
 *   2. user is Department.headId on any departments → dept scope (all those depts)
 *   3. user has any active GroupMembership where isLead=true → group scope (all those groups)
 *   4. user is role=manager with reports → reports-only (legacy Sprint-11 fallback)
 *   5. else → none (staff)
 */
export async function resolveScope(user: AuthenticatedUser): Promise<Scope> {
  if (user.role === "admin") return { type: "org", orgId: user.orgId };

  const headedDepts = await prisma.department.findMany({
    where: { headId: user.id, orgId: user.orgId },
    select: { id: true },
  });
  if (headedDepts.length > 0) {
    return {
      type: "dept",
      departmentIds: headedDepts.map((d) => d.id),
      orgId: user.orgId,
    };
  }

  const ledGroups = await prisma.groupMembership.findMany({
    where: { userId: user.id, isLead: true, validTo: null },
    select: { groupId: true },
  });
  if (ledGroups.length > 0) {
    return {
      type: "group",
      groupIds: ledGroups.map((g) => g.groupId),
      orgId: user.orgId,
    };
  }

  if (user.role === "manager" && user.reportIds.size > 0) {
    return {
      type: "reports-only",
      reportIds: Array.from(user.reportIds),
      orgId: user.orgId,
    };
  }

  return { type: "none" };
}
```

### Modify: `Backend_task_list/src/utils/auth.ts`

Add ONE clause to the existing `canAccessTask`. The current function checks: admin OR assignee OR creator OR manager-of-assignee. Add: **OR isLead on any active group containing the assignee**.

Implementation note: this is one Prisma query — `groupMembership.findFirst({ where: { userId: actor.id, isLead: true, validTo: null, group: { memberships: { some: { userId: task.assigneeId, validTo: null } } } } })`. If the function is currently sync, make it async; update all callers (grep `canAccessTask`).

### No other code changes

Do **not** create dashboard controllers, services, or routes in this sprint. Those are Sprint 16B.

---

## Acceptance criteria

A reviewer reading the diff should be able to verify each of these in <5 minutes:

- [ ] One migration file, additive only, no DROP/ALTER on existing not-null columns
- [ ] All five new models present in `schema.prisma` with the exact indexes specified
- [ ] `User.level` populated from role for all 18 seeded users (12 existing + 6 new)
- [ ] `Department.headId` set for all 5 departments
- [ ] At least 7 `ContextGroup` rows seeded with realistic names
- [ ] Sneha has memberships in BOTH Ward 12 AND Night Shift (the cross-group proof)
- [ ] Deliberate submission gaps seeded exactly as specified (Sneha missing today-2 and today-4, etc.)
- [ ] `resolveScope()` covers all 5 cases and each is independently testable
- [ ] `canAccessTask` returns true for a group-lead querying an in-group assignee's task
- [ ] `_UserHierarchy` edges from existing seed remain byte-identical
- [ ] No personal-flow files touched (grep diff for `voice-intent.ts`, `text-intent.ts`, `image-extraction.ts`, `unified-intent.ts` — should be empty)
- [ ] `npm run typecheck && npm run lint && npm run build` clean
- [ ] `npx prisma migrate reset --force && npx tsx prisma/seed-hierarchy.ts` runs to completion in <60s

---

## Smoke matrix

Run each manually after Phase 3. Use existing seed creds (e.g., `sharma@kims.demo` / `kims2026`). If your usual dev server is on port 8000, log in first via the existing auth flow to get a token.

| # | Setup | Action | Expected |
|---|---|---|---|
| S1 | Fresh DB after migrate reset + seed | `prisma.user.count()` | 18 |
| S2 | Fresh DB | `prisma.department.count()` | 5 |
| S3 | Fresh DB | `prisma.contextGroup.count()` | 7 |
| S4 | Fresh DB | `prisma.groupMembership.count({ where: { userId: sneha.id, validTo: null } })` | 2 |
| S5 | Run `resolveScope(iyer)` | — | `{ type: "org", orgId: "kims-hospital" }` |
| S6 | Run `resolveScope(sharma)` | — | `{ type: "dept", departmentIds: [medicine.id], orgId: ... }` |
| S7 | Run `resolveScope(rahul)` | — | `{ type: "dept", departmentIds: [nursing.id], orgId: ... }` (he's BOTH Nursing HOD and Ward 12 lead — dept resolves first per priority order) |
| S8 | Run `resolveScope(priya)` | — | `{ type: "group", groupIds: [ot2.id, otNursingPool.id], orgId: ... }` (no dept headship; isLead on 2 groups) |
| S9 | Run `resolveScope(sneha)` | — | `{ type: "none" }` |
| S10 | A Task assigned to Sneha, created by Sharma | `canAccessTask(rahul, task)` | `true` (Rahul is Ward 12 lead, Sneha is in Ward 12) |
| S11 | A Task assigned to Manoj (OT-2, Surgery dept) | `canAccessTask(rahul, task)` | `false` (Rahul is not in OT-2) |
| S12 | Count `DayPlanSubmission where userId=sneha.id` | — | 6 (8 days minus the 2 deliberate gaps) |

---

## Failure modes & escape hatches

**FM1 — Migration breaks on existing dev DBs.** If a teammate has stale demo data, `prisma migrate dev` might fail mid-way. Mitigation: this is POC; if migration fails on a dirty DB, run `prisma migrate reset --force` and re-seed. Document this in the sprint completion note.

**FM2 — `canAccessTask` becoming async breaks call sites that assumed sync.** Grep the codebase for `canAccessTask(` before merging. Every call site needs an `await`. Fix them in the same commit.

**FM3 — Composite PK on `GroupMembership` rejects same-millisecond re-adds.** Edge case in seed scripts. If you hit this, advance `validFrom` by 1ms manually in the seed. Known limitation; not a blocker.

**FM4 — Seed idempotency.** If `upsert` is used carelessly, re-running the seed could duplicate memberships (composite PK including timestamps makes them look "different"). Use a deterministic `validFrom` for all seeded memberships (`new Date('2026-05-15')`) so upserts on `[userId, groupId, validFrom]` work.

**FM5 — `User.level` mismatch with role.** If the seed sets level to 100 but the user is role=manager, future `requireSuperiorLevel` middleware (F3) will be confused. Always derive level from role at seed time; never hand-set.

---

## Handoff state at end of sprint

When you mark this sprint complete, the codebase should be in this state:

1. Migration applied. `prisma generate` produces a client with all 5 new models.
2. Seed populates 18 users, 5 depts, 7 groups, ~30 memberships, 8 days of backdated tasks + submissions with documented gaps.
3. `resolveScope()` is callable from any service and returns correct shape for each of the 5 cases.
4. `canAccessTask()` works for the new group-lead case.
5. `_UserHierarchy` M2M and Sprint 11 `team-action-dispatch` flow are byte-identical to before this sprint.
6. No `/dashboard/*` endpoints exist yet.

**Write a `## Implementation Notes` section at the bottom of this file** (the way Sprint 15 did) describing: which migration filename you committed, any deviations from this spec (with rationale), exact seed counts achieved, and any FM you hit. Sprint 16B starts by reading that section.

---

## What to update before closing the sprint

- [Backend_task_list/.agents/STATE.md](Backend_task_list/.agents/STATE.md) — add Sprint 16A row to the sprint status table; append a changelog entry under today's date
- This file — add the `## Implementation Notes` section

---

## Implementation Notes

Implemented on 2026-05-26.

### Migration

- Migration file: `prisma/migrations/20260526170841_add_hierarchy_foundation/migration.sql`
- Additive schema delta only:
  - `User.level Int @default(100)`
  - `Task.groupId String?` + `@@index([groupId, targetDate])`
  - New models: `Department`, `ContextGroup`, `GroupMembership`, `SubmissionReview`, `ReminderIntent`
- No review columns were added to `DayPlanSubmission` or `DayClosureSubmission`; per-manager review state lives in `SubmissionReview` as locked by L2.
- `_UserHierarchy` was not modified.

### Seed Counts

Fresh seeded KIMS org after `npx tsx prisma/seed-hierarchy.ts`:

- Users: 18
- Departments: 5
- ContextGroups: 7
- Active GroupMembership rows: 29
- Sprint 16A historical tasks: 612
- DayPlan gaps verified: Sneha has 6 submissions across the 8-day history window.

The seed creates 29 memberships rather than the spec's rough "~30" by adding Dr. Iyer as a non-lead executive member across all 7 groups. This satisfies the "every user has at least one active membership" rule without affecting `resolveScope()` because admin resolves to org scope first.

### Implementation Deviations

- The seed is idempotent by cleaning/recreating Sprint 16A demo-derived rows for departments, groups, memberships, the 8-day submission window, seed-tagged tasks, seed interactions, and seed meetings. It does not delete or recreate users, and it preserves/adds `_UserHierarchy` edges with `ON CONFLICT DO NOTHING`. This is more reliable than upserting departments/groups because the schema intentionally has no natural unique key for `[orgId, name]`.
- Historical tasks are tagged with `sourceId` prefix `sprint16a-seed:*` so reruns do not duplicate them and do not touch unrelated manual tasks.
- Group names use ASCII hyphens instead of en/em dashes to keep file edits ASCII-only.

### Verification

- `npx prisma generate` clean.
- `npm run typecheck`, `npm run lint`, and `npm run build` clean.
- `npx prisma migrate dev` applied `20260526170841_add_hierarchy_foundation`.
- `npx prisma migrate reset --force && npx tsx prisma/seed-hierarchy.ts` ran clean from a fresh DB.
- `npx tsx prisma/seed-hierarchy.ts` ran twice with stable counts.
- Smoke script verified:
  - user/dept/group counts = 18/5/7
  - Sneha active memberships = 2
  - `resolveScope(iyer)` -> org
  - `resolveScope(sharma)` -> dept
  - `resolveScope(rahul)` -> dept, proving dept-head priority beats group-lead
  - `resolveScope(priya)` -> group with 2 led groups
  - `resolveScope(sneha)` -> none
  - `canAccessTask(priya, manojTask)` -> true while `priya.reportIds.has(manoj.id)` is false, proving group-lead access independently from `_UserHierarchy`
  - `canAccessTask(rahul, snehaTask)` -> true
  - `canAccessTask(rahul, manojTask)` -> false

End of Sprint 16A spec.
