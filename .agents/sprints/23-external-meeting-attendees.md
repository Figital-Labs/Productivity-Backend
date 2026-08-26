---
id: SPRINT-BE-23
title: External meeting attendees — free-text name/email for people not on the app
status: not-started
date: 2026-08-25
tags: [sprint, meetings, attendees, multi-tenant, ai, prompts]
related: [BE-SPRINT-15, STATE, SPRINTS-INDEX]
---

# Backend Sprint 23 — External meeting attendees

## Goal

Let a user record a meeting whose participants are **not users of the app** — a vendor, a
consultant, a doctor from another hospital, a candidate — by typing a **name** and an
**optional email** instead of picking from the org directory.

## Why this is happening

Today `POST /meetings` requires `attendeeIds: string[]` of **real, same-org User ids**, minimum
one. Anyone outside the org simply cannot be recorded as present. Users are working around this
by either omitting them (so the AI has no idea who spoke) or by typing their name into `agenda`
(where nothing structured can use it).

Multi-org matters here: as we take on tenants beyond KIMS, cross-company meetings become normal
rather than exceptional.

## The constraint that drives the whole design

**`attendeeIds` is an access-control list, not just a label.** Two places depend on every entry
resolving to a real same-org user:

| Location | Behaviour |
| --- | --- |
| `meeting.repository.ts:41` | `OR: [{ userId }, { attendeeIds: { has: userId } }]` — **being an attendee grants read access to the meeting** |
| `meeting.service.ts:88-101` | `assertAttendeesInOrg` throws `ATTENDEE_NOT_IN_ORG` if `rows.length !== attendeeIds.length` |
| `meeting.service.ts:115` | `hydrate()` does `userRepo.findByIds()` — an unresolvable id **silently disappears** from the response |

So external attendees **must not** be stuffed into `attendeeIds` as sentinel strings. Doing so
would either be rejected at create time or vanish on read, and it would quietly erode the
invariant that the ACL is a list of real users.

→ **They go in a separate column.**

## Locked decisions

1. **New column, not a mixed array.** `Meeting.externalAttendees Json @default("[]")`, shaped
   `Array<{ name: string; email?: string }>`. Additive and nullable-by-default, so the migration
   touches no existing row and older builds ignore it.
2. **External attendees cannot be an `assigneeId`.** Note the existing pipeline **never
   auto-creates tasks** — `persistedActions` is always `[]` at `meeting.service.ts:518`, and
   every AI action is converted to a *recommendation* the manager confirms. So the risk here is
   narrower than it first appears: the only thing to get right is that an action attributed to
   an external person yields a recommendation **with no `assigneeId`**, whose text names them in
   plain words ("Dr Rao agreed to send the quote"). The guardrail at
   `meeting.service.ts:504-512` already drops an `assigneeId` that isn't a real attendee, so the
   default behaviour is correct — this sprint makes it *intentional* rather than incidental.
3. **External attendees get no read access.** They aren't users; there is nothing to grant.
4. **The AI must still know their names.** Otherwise it cannot attribute speech, and it will
   produce worse summaries than it does today. They go into the prompt with an explicit marker.
5. **Meetings may have zero internal attendees.** A 1-on-1 with a vendor is legitimate. Relax
   `attendeeIds.min(1)` → `.min(0)`, with a cross-field rule that at least one attendee exists
   overall (internal **or** external). The creator is always implicitly present.
6. **No auto-linking when an external person later signs up.** Out of scope; see Deferred.

## API contract

`POST /meetings` and `PATCH /meetings/:id` gain an optional field:

```jsonc
{
  "attendeeIds": ["usr_abc"],              // unchanged: real same-org users, now min 0
  "externalAttendees": [                    // NEW, optional, default []
    { "name": "Dr Rao", "email": "rao@apollo.com" },
    { "name": "Vendor rep" }                // email optional
  ]
}
```

`GET /meetings/:id` returns them alongside the hydrated internal list — **separate arrays**, so
the frontend can style them differently and never mistake one for the other:

```jsonc
{
  "attendees":         [{ "id": "usr_abc", "email": "…", "name": "…", "role": "staff" }],
  "externalAttendees": [{ "name": "Dr Rao", "email": "rao@apollo.com" }]
}
```

### Validation

| Rule | Value |
| --- | --- |
| `name` | required, trimmed, 1–120 chars |
| `email` | optional; if present must be a valid email, ≤ 200 chars, stored lowercased |
| Array cap | 20 external (internal cap stays 50) |
| Dedupe | case-insensitive on `email` when present, else on `name`; last write wins |
| Combined | `attendeeIds.length + externalAttendees.length >= 1` |

Reject with `400 VALIDATION_ERROR`. **Do not** attempt to match an external email against an
existing user and silently convert it — a silent identity change is worse than a duplicate chip.
Instead return `409 EXTERNAL_ATTENDEE_IS_USER` naming the match, and let the UI offer to add
them as a real attendee. (This also stops someone granting meeting access by typing an email.)

## AI prompt changes

`MeetingAttendee` currently is `{ id, name, role }` and the model assigns actions by `id`.
External attendees enter the same array with a **synthetic, non-assignable id**:

```ts
{ id: "external:0", name: "Dr Rao", role: "external" }
```

Add one rule to `meeting-intent.ts`, alongside the existing "ambiguous name → recommendation"
rule (rule 4):

> An attendee whose `role` is `"external"` is **not** a user of the system. Never emit them as
> `assigneeId`. Describe the work and name them in plain words instead.

Everything the model emits already becomes a recommendation, so this is about *attribution
quality*, not about preventing a wrong task. The guardrail at `meeting.service.ts:504-512`
already strips an `assigneeId` that isn't a real attendee — so if the model ignores the rule the
recommendation simply arrives unassigned, which is the correct outcome. The prompt rule makes
the recommendation's **text** carry who committed, so the manager isn't left guessing.

⚠️ Keep the existing prohibition (prompt line ~127) on exposing internal mechanics. The model
must never say "their ID is not in the attendees list" or mention `external:0` in user-facing
copy.

## Frontend (parallel sprint)

- Attendee picker gains **"Add someone not on the app"** → name field + optional email.
- External chips are visually distinct from directory chips (e.g. dashed border), so nobody
  believes they'll receive a task or see the meeting.
- On the results screen, a recommendation attributed to an external person reads naturally
  ("Dr Rao agreed to send the quote") with an **Assign** affordance targeting a real user.

## Tasks

1. **Migration** — `ALTER TABLE "Meeting" ADD COLUMN "externalAttendees" JSONB NOT NULL DEFAULT '[]'`.
   Additive; safe to apply while running.
2. **Schema** — `externalAttendeeSchema` + wire into create/update; relax `attendeeIds` to `.min(0)`;
   add the combined-count refinement.
3. **Service** — persist/echo `externalAttendees`; extend `hydrate()`; add the
   `EXTERNAL_ATTENDEE_IS_USER` pre-check.
4. **Prompt** — inject external attendees with `role: "external"`; add the rule; add a fixture to
   the eval set covering "action attributed to an external attendee → recommendation, not task".
5. **Activity feed** — `activity.schema.ts:132` (`attendees: z.array(meetingAttendeeRefSchema)`)
   must carry external chips too, or the feed will misrepresent who was in the room.

## Smoke matrix

| # | Case | Expect |
| --- | --- | --- |
| 1 | Create with 1 internal + 1 external | 201; both returned in their own arrays |
| 2 | Create with **only** external | 201 (creator is implicitly present) |
| 3 | Create with neither | 400 — at least one attendee required |
| 4 | External email matching an existing user | 409 `EXTERNAL_ATTENDEE_IS_USER` |
| 5 | 21 external attendees | 400 |
| 6 | Duplicate email, different case | Deduped to one |
| 7 | Process a recording where an external person commits to work | **Recommendation**, not a task; no `assigneeId` |
| 8 | Existing meeting created before this sprint | Reads back with `externalAttendees: []` |
| 9 | Internal attendee opens the meeting | Still visible (ACL unchanged) |

## Risks

- **The ACL invariant** is the thing most likely to be broken by a "simpler" implementation that
  reuses `attendeeIds`. Anyone shortcutting this reintroduces the bug this design avoids.
- **PII**: external names/emails are third-party personal data stored per meeting. Deletion of a
  meeting must remove them (already covered by the existing soft-delete/purge path — verify).
- **Prompt regression**: adding an attendee `role` value the model has never seen can shift its
  behaviour on unrelated cases. Run the existing meeting evals before/after, not just the new fixture.

## Deferred (do NOT implement)

- Auto-linking an external attendee to a user account when that email later signs up.
- Inviting external attendees by email.
- A reusable per-org contact book of past external attendees.
- Any read access for external people.
