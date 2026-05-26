---
id: SPRINT-BE-14
title: Attach Existing User to Team (Backend)
status: not-started
date: 2026-05-26
tags: [sprint, team, hierarchy, multi-user]
related: [STATE, SPRINTS-INDEX, FE-SPRINT-14, BE-SPRINT-11]
parallel_with: Task-List/.agents/sprints/14-add-existing-user.md
---

# Backend Sprint 14 — Attach Existing User to Team

## Goal

Add a single endpoint that lets a manager attach an **existing** same-org user to their reports list, without creating a new account. Today's only path is `POST /team/users` which creates a fresh user — there's no way to wire `Mehta → Sneha` if Sneha already exists under `Sharma + Rahul`.

This sprint ships **one endpoint + one schema + one service function + one row in `team.routes.ts`**. No migration, no schema delta, no AI work, no FE coupling other than the documented contract below.

Owner: TBD. Estimate: ~45 min. **Can run in parallel with FE Sprint 14** — FE scaffolds against this contract.

---

## Why this is happening

Sprint 11 deliberately deferred "cross-team add (assign EXISTING user as additional report)" — see [sprints/11-hierarchy-and-delegation.md](./11-hierarchy-and-delegation.md) "Deferred". Demo testing surfaced the real need: in a hospital, the same nurse routinely reports to a Head Nurse AND an Attending Doctor. The matrix M2M is already in the schema (`_UserHierarchy`); the missing piece is the API surface that lets a manager opt-in to that relationship.

This sprint closes the gap with the **lightest possible shape**: a manager submits an email, BE looks up the same-org user, attaches via `reports.connect`. No invite flow, no role change, no notifications.

---

## Locked decisions

1. **Same-org only.** If the target user's `orgId !== creator.orgId`, return 404 (do not leak existence across orgs).
2. **By email, not by id.** The manager doesn't know other users' ids; they know emails. Single round-trip.
3. **Idempotency = 409.** If the target is already in `manager.reportIds`, return 409 `ALREADY_A_REPORT`. Don't silently no-op — the manager should know they already manage this person.
4. **No role change.** The target keeps whatever role they have (`staff` or `manager`). A manager attaching a `manager` peer as a report is allowed — that's the doctor-over-head-nurse case.
5. **Self-attach blocked.** If `target.id === creator.id`, return 400. Trivial guard.
6. **Attaching admin is blocked.** If the target's role is `admin`, return 403 `CANNOT_ATTACH_ADMIN`. Admins don't report to anyone.
7. **No password concerns.** Existing user; their password is theirs.
8. **No invite / notification.** POC scope — the manager tells the staff out-of-band.
9. **`requireManager` middleware applies.** Same gate as the rest of `/team/*`.

---

## API contract (locked — FE consumes this verbatim)

### `POST /team/users/attach`

**Auth:** Bearer JWT; role must be `manager` or `admin` (via existing `requireManager` middleware).

**Request body:**
```json
{ "email": "sneha@kims.demo" }
```

**Validation (Zod):**
- `email`: required, valid email format, max 200 chars.

**Responses:**

| Status | Code                 | When                                           | Body |
|--------|----------------------|------------------------------------------------|------|
| 201    | —                    | Successfully attached                          | `PublicTeamUser` (same shape as `POST /team/users` returns) |
| 400    | `VALIDATION_ERROR`   | Bad email shape, missing field                 | standard error envelope |
| 400    | `CANNOT_ATTACH_SELF` | `target.id === creator.id`                     | standard error envelope |
| 401    | (jwt middleware)     | Missing/invalid token                          | — |
| 403    | `FORBIDDEN`          | Caller is not `manager` or `admin`             | (existing `requireManager`) |
| 403    | `CANNOT_ATTACH_ADMIN`| Target user is an admin                        | standard error envelope |
| 404    | `USER_NOT_FOUND`     | No user with that email in caller's org        | standard error envelope |
| 409    | `ALREADY_A_REPORT`   | Target is already in caller's `reportIds`      | standard error envelope |

**Success response shape (201):**
```ts
type PublicTeamUser = {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
};
```

Same shape `POST /team/users` returns. The FE adds the returned user to its `reports` list and re-fetches the dashboard rollup.

---

## Tasks

### 14.1 — Schema

**File**: [src/schemas/team.schema.ts](../../src/schemas/team.schema.ts)

Add at the end of the file (mirroring `createTeamUserInputSchema` shape):

```ts
/**
 * Body for `POST /team/users/attach` — manager attaches an existing same-org
 * user to their reports list. No new user is created; only the m2m hierarchy
 * edge is added. Used when a staff member already exists under another
 * manager and a new manager needs to also supervise them (matrix authority).
 */
export const attachExistingUserInputSchema = z.object({
  email: z.email("email must be a valid email").max(200),
});
export type AttachExistingUserInput = z.infer<typeof attachExistingUserInputSchema>;
```

### 14.2 — Service

**File**: [src/services/team.service.ts](../../src/services/team.service.ts)

Add a new `ValidationError` import if not present, and a new function near `createUser`:

```ts
/**
 * Manager attaches an EXISTING same-org user as a report. Idempotency =
 * 409 (we surface "already attached" to the manager rather than silently
 * succeed). No role change, no password change, no notification.
 */
export async function attachExistingUser(
  creator: AuthenticatedUser,
  input: AttachExistingUserInput,
): Promise<PublicTeamUser> {
  const target = await prisma.user.findUnique({ where: { email: input.email } });
  if (!target || target.orgId !== creator.orgId) {
    throw new NotFoundError("User", input.email);
  }
  if (target.id === creator.id) {
    throw new ValidationError("Cannot attach yourself as a report", "CANNOT_ATTACH_SELF");
  }
  if (target.role === "admin") {
    throw new ForbiddenError("Cannot attach an admin as a report", "CANNOT_ATTACH_ADMIN");
  }
  if (creator.reportIds.has(target.id)) {
    throw new ConflictError("ALREADY_A_REPORT", "This user already reports to you.");
  }

  await prisma.user.update({
    where: { id: creator.id },
    data: { reports: { connect: { id: target.id } } },
  });

  return toPublicTeamUser(target);
}
```

**Notes for the implementer:**
- `ValidationError` may need a `code` param — check its current signature in `src/lib/errors.ts`. Sprint 11 uses `ConflictError("USER_ALREADY_EXISTS", "...")` so the pattern is `(code, message)`. If `ValidationError` doesn't take a code yet, either extend it or throw a `ConflictError`-style error with code `CANNOT_ATTACH_SELF`. Whichever matches the existing error envelope shape.
- `ForbiddenError` likewise — check its signature.
- **Do NOT** use `prisma.$transaction` — only one write, no need.

### 14.3 — Controller

**File**: [src/controllers/team.controller.ts](../../src/controllers/team.controller.ts)

Add an import for the new schema, and a new handler after `createUser`:

```ts
export async function attachExistingUser(req: Request, res: Response): Promise<void> {
  const input = attachExistingUserInputSchema.parse((req.body as unknown) ?? {});
  const user = await teamService.attachExistingUser(req.user, input);
  res.status(201).json(user);
}
```

### 14.4 — Route

**File**: [src/routes/team.routes.ts](../../src/routes/team.routes.ts)

Add **before** the existing `POST /users` line (so a stricter path `/users/attach` doesn't get shadowed if Express path-matching changes; for current Express 5 this isn't strictly necessary, but it documents intent):

```ts
// User CRUD + password mgmt
teamRouter.post("/users/attach", teamController.attachExistingUser);
teamRouter.post("/users", teamController.createUser);
teamRouter.post("/users/:id/reset-password", teamController.resetUserPassword);
```

### 14.5 — BACKEND_GUIDE.md

**File**: [Backend_task_list/BACKEND_GUIDE.md](../../BACKEND_GUIDE.md)

Add a new row in the Team API reference table and a small "user journey" note. Mirror the existing `POST /team/users` entry. Keep it terse — 5-6 lines.

### 14.6 — STATE.md update

**File**: [.agents/STATE.md](../STATE.md)

- Bump "14 — Alerts" to "15 — Alerts", "15 — Polish" to "16 — Polish" (matches the Sprint 11/13 renumbering pattern).
- Insert new row: `| 14 — Attach existing user to team | 🟢 ready for review | <owner> | 2026-05-26 | 2026-05-26 | [sprints/14-attach-existing-user.md](./sprints/14-attach-existing-user.md) |`
- Append a changelog entry under `### 2026-05-26` summarizing the four changes (schema, service, controller, route).

---

## Smoke matrix (must all pass before checkpoint)

Run against live dev server (`localhost:8000`) with seeded `kims-hospital` org. Use Sharma / Mehta tokens from the demo seed (password `kims2026`).

Login flow for tests (one-time):
```bash
# Sharma's token (manages Sneha + Amit + Suresh in seed)
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"sharma@kims.demo","password":"kims2026"}' | jq -r .token

# Mehta's token (manages Anita + Vikram + Manoj in seed)
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"mehta@kims.demo","password":"kims2026"}' | jq -r .token
```

| # | Case                                                | Body                                  | Expected         |
|---|-----------------------------------------------------|---------------------------------------|------------------|
| 1 | Mehta attaches Suresh (Sharma's report)             | `{"email":"suresh@kims.demo"}`        | 201 + PublicTeamUser |
| 2 | Mehta re-attaches Suresh (idempotency surface)      | same                                  | 409 `ALREADY_A_REPORT` |
| 3 | Mehta attaches non-existent email                   | `{"email":"ghost@kims.demo"}`         | 404 `USER_NOT_FOUND` |
| 4 | Mehta attaches herself                              | `{"email":"mehta@kims.demo"}`         | 400 `CANNOT_ATTACH_SELF` |
| 5 | Mehta attaches an admin (seed: none, create one)    | `{"email":"<admin email>"}`           | 403 `CANNOT_ATTACH_ADMIN` |
| 6 | Bad email shape                                     | `{"email":"not-an-email"}`            | 400 `VALIDATION_ERROR` |
| 7 | Missing body                                         | `{}`                                  | 400 `VALIDATION_ERROR` |
| 8 | Staff caller (Sneha) tries to attach                | `{"email":"suresh@kims.demo"}`        | 403 (requireManager) |
| 9 | After test 1, Mehta sees Suresh in `GET /team/reports` | —                                  | 200 with Suresh row |
|10 | After test 1, Mehta can `GET /team/reports/<sureshId>/tasks?date=...` | — | 200 with task list |

**Regression checks (must still pass — no behavior change expected):**
- `POST /team/users` still creates a fresh user. Smoke: create a throwaway user, confirm hierarchy edge added.
- `POST /team/users/:id/reset-password` still works.
- Sharma still sees Suresh as a report (test 1 doesn't remove him from Sharma, only adds to Mehta — verifying the matrix semantics).
- `npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅.

---

## Files touched

| File | Change |
|---|---|
| [src/schemas/team.schema.ts](../../src/schemas/team.schema.ts) | Add `attachExistingUserInputSchema` + type |
| [src/services/team.service.ts](../../src/services/team.service.ts) | Add `attachExistingUser()` function |
| [src/controllers/team.controller.ts](../../src/controllers/team.controller.ts) | Add controller handler + import |
| [src/routes/team.routes.ts](../../src/routes/team.routes.ts) | Add route line |
| [BACKEND_GUIDE.md](../../BACKEND_GUIDE.md) | Add API row |
| [.agents/STATE.md](../STATE.md) | Renumber + insert row + changelog |

---

## Deferred (do NOT implement)

- **Detach** (`DELETE /team/users/:id/attach`) — symmetrical removal. User hasn't asked for it; add later if needed.
- **Bulk attach** (CSV / multi-email) — POC scope; one-by-one is fine.
- **Search / autocomplete by name** — FE uses email-only input. Adding a lookup endpoint is unscoped.
- **Notification to the attached user** — out-of-band per locked decision #8.
- **Audit log** — derived projection (Sprint 09 / ADR-0024) doesn't cover hierarchy edges. Not retrofitting.
- **Cross-org attach** — explicit 404 per locked decision #1.

---

## Risks

**Risk 1: `requireManager` middleware semantics.** Verify the existing middleware lets `admin` through too (Sprint 11 contract). If it gates on `manager` only, an admin caller will 403 on this endpoint — acceptable since admins typically don't manage teams directly in our seed, but document the behavior.

**Risk 2: Error envelope drift.** Sprint 11's error code constants live in `src/lib/errors.ts`. The new codes (`CANNOT_ATTACH_SELF`, `CANNOT_ATTACH_ADMIN`, `ALREADY_A_REPORT`, `USER_NOT_FOUND`) must round-trip through the central error middleware with the same `{ code, message }` envelope. Sanity-check by looking at how `USER_ALREADY_EXISTS` is serialized in Sprint 11 smoke logs.

**Risk 3: `reportIds` cache staleness.** `reportIds` is computed once per request in `src/middleware/auth.ts`. After a successful attach, the SAME request's `reportIds` doesn't update — but that's fine (we already returned 201 and don't re-check). The NEXT request from the manager will see the new edge. Document this implicit behavior in the service function's docstring.

---

## Addendum (2026-05-26) — Same-org user search endpoint

User feedback after the attach endpoint shipped: email-only input is awkward. Real-life UX is "open a picker, see the org list, search by name, click to attach." This addendum adds a reusable search endpoint that the FE picker (and future Meetings invite picker) consume.

### `GET /api/v1/users/search?q=<optional>`

**Auth:** Bearer JWT. **No role gate** — staff can call it (Meetings invite picker will need it). `jwtAuth` is applied at the v1 router level.

**Query (Zod):**
- `q`: optional string, max 120 chars. Empty/missing → returns full same-org list.

**Behavior:**
- Same-org only. The endpoint silently scopes by `caller.orgId`; no cross-org enumeration possible.
- `q` matches against `name` OR `email` (case-insensitive substring; Postgres `ILIKE` via Prisma `mode: 'insensitive'`).
- Sorted by `name` ascending.
- Capped at 50 results (no pagination — POC scope; can revisit when an org grows past that).
- Includes the caller themselves and admins. **FE filters/disables both** based on use case.

**Response 200:**
```ts
type PublicUserSummary = {
  id: string;
  email: string;
  name: string;
  role: 'staff' | 'manager' | 'admin';
};
// → PublicUserSummary[]
```

Note: `orgId` is intentionally omitted from the response — it's always the caller's org, redundant on the wire.

**Errors:**
- `401 UNAUTHORIZED` — missing/invalid token (existing middleware).
- `400 VALIDATION_ERROR` — `q` exceeds 120 chars (rare; defensive).

### Files added

| File | Purpose |
|---|---|
| [src/schemas/users.schema.ts](../../src/schemas/users.schema.ts) | `searchUsersQuerySchema` ({ q? }) |
| [src/services/users.service.ts](../../src/services/users.service.ts) | `searchSameOrg(caller, query)` + `PublicUserSummary` |
| [src/controllers/users.controller.ts](../../src/controllers/users.controller.ts) | `searchUsers` handler |
| [src/routes/users.routes.ts](../../src/routes/users.routes.ts) | `GET /search` |
| [src/repositories/user.repository.ts](../../src/repositories/user.repository.ts) | New `searchSameOrg(orgId, q, take)` helper |
| [src/routes/v1.ts](../../src/routes/v1.ts) | Mount `usersRouter` at `/users` |

### Smoke matrix (all green)

| # | Case | Expected |
|---|---|---|
| T11 | `GET /users/search` no q, Sharma | 200 + 12 org users sorted by name |
| T12 | `?q=sneha` | 200 + 1 (Sister Sneha) |
| T13 | `?q=SISTER` (uppercase) | 200 + 4 sisters (case-insensitive) |
| T14 | `?q=@kims` (email substring) | 200 + 12 (all match) |
| T15 | `?q=zzz` (no match) | 200 + [] |
| T16 | Staff (Sneha) calls `?q=mehta` | 200 + 1 (no role gate) |
| T17 | No auth header | 401 UNAUTHORIZED |

### Frontend integration note

The FE Sprint 14 modal (Add Existing tab) should use this endpoint as the source for its scrollable list:

1. On modal open: `GET /users/search` (no q) → render full list.
2. On search input change: debounced `GET /users/search?q=<input>` (250ms is fine).
3. For each row, disable + label "Already in team" if `row.id` is in the dashboard's `reports.map(r => r.id)` set.
4. Disable + label "Admin — can't attach" if `row.role === 'admin'`.
5. Disable + label "You" if `row.id === auth.user.id`.
6. On row click (when enabled): call existing `POST /team/users/attach { email: row.email }`.

The attach endpoint contract is unchanged — only the FE picker UX changes from a free-text email input to a list+search picker.
