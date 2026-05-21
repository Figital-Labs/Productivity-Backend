---
id: ADR-0010
title: Per-user timezone, default Asia/Kolkata
status: accepted
date: 2026-05-22
tags: [schema, ux]
supersedes: null
related: [ADR-0011]
---

# ADR-0010: Per-User Timezone

## Context

Day-plan and day-closure are tied to a **calendar day**. The query "give me today's tasks" has a definition that depends on what time zone "today" is computed in. If a hospital staff member is in IST and the server is in UTC, "today's tasks" must mean *their* today.

## Decision

`User.timezone` column. Default `Asia/Kolkata` (likely target client is in India). All "today" queries compute the user's local date — store an absolute timestamp + a date-only `targetDate` column on Task.

The `utils/date.ts` helper exports `userToday(user): Date` which returns the date-only value for the user's current local day.

## Reasoning

- **Day-plan tied to a calendar day means "today" must be the user's today**, not the server's.
- **Hardcoding one timezone** would box us in once we have users in other regions.
- **The cost of storing a string per user is zero.**

## Alternatives Considered

- **Server UTC for everything** — "today" shifts at midnight UTC; weird UX for IST users at 05:30. Rejected.
- **Single hardcoded timezone (`Asia/Kolkata`) without a column** — works for one region, painful when expanding. Rejected; adding the column now costs nothing.

## Consequences

- All date math goes through `utils/date.ts`. Don't compute "today" inline anywhere.
- `Task.targetDate` is `@db.Date` (date-only, no time/zone) — the date in the user's local calendar.
- Submission tables (`DayPlanSubmission`, `DayClosureSubmission`) also use `@db.Date` keyed to user's local day.

## Revisit If

Never. This is correctness, not optimization.
