---
id: ADR-0011
title: Submit semantics — soft lock with immutable snapshot
status: accepted
date: 2026-05-22
tags: [schema, product]
supersedes: null
related: [ADR-0010, ADR-0013]
---

# ADR-0011: Submit Semantics — Soft Lock with Immutable Snapshot

## Context

When the user hits "Submit Day Plan," what happens? Options:
- (a) Hard lock — no more edits to today's tasks after submit.
- (b) Soft lock — record a timestamp, but keep allowing edits.
- (c) Soft lock + immutable snapshot — record the state at submission, but keep the live task list mutable.

Hard lock fails when users remember a task at 09:05 after submitting at 09:00. Plain timestamp loses the audit trail (a future manager couldn't see what was promised vs delivered). Snapshot wins.

## Decision

`POST /day-plan/submit` records:
- `submittedAt` timestamp
- `taskSnapshot` — immutable JSON copy of the task list at the moment of submission

The user can keep editing the live task list afterward. **The snapshot stays unchanged.** Same model for `DayClosureSubmission`.

```prisma
model DayPlanSubmission {
  id           String   @id @default(cuid())
  userId       String
  date         DateTime @db.Date
  submittedAt  DateTime @default(now())
  taskSnapshot Json     // immutable
  @@unique([userId, date])
}
```

## Reasoning

- **Mobile users always need to edit after submit.** They remember things at 09:05.
- **The snapshot is the *commitment*** — it's what a future manager would review.
- **Live task list keeps reflecting reality**, but the snapshot is the audit record.
- **`@@unique([userId, date])`** prevents duplicate submissions per day. Re-submitting overwrites the timestamp; an additional check decides whether to re-snapshot.

## Alternatives Considered

- **Hard lock** — punishes the user who forgot something. Rejected.
- **Just a timestamp, no snapshot** — loses audit trail. Manager can't see what was promised. Rejected.

## Consequences

- `taskSnapshot` is JSON, not a relational link. Tasks may be deleted later; the snapshot remains.
- The snapshot includes `id`, `title`, `priority`, `completed`, `isPartial` at submission time.
- The submission endpoint is idempotent on `(userId, date)` — re-submitting the same day overwrites. (See [ADR-0017](./0017-idempotency-keys.md) for general idempotency.)

## Revisit If

Never. This is the correct shape.
