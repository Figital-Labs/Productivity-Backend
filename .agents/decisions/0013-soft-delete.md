---
id: ADR-0013
title: Soft delete via `deletedAt` timestamp
status: accepted
date: 2026-05-22
tags: [schema]
supersedes: null
related: [ADR-0011]
---

# ADR-0013: Soft Delete via `deletedAt`

## Context

The frontend has a "restore" UI in `AppContext.tsx` (`restoreTask` function). The backend needs to support undoing a delete, which means we can't hard-delete rows.

## Decision

`Task` and `Note` have a nullable `deletedAt` timestamp column. Default queries filter `deletedAt IS NULL`. A `POST /tasks/:id/restore` endpoint clears it.

```prisma
model Task {
  // ...
  deletedAt DateTime?
  @@index([userId, deletedAt])
}
```

`Alert.dismissedAt` plays an analogous role for alerts (dismissed alerts are still visible in history; not technically "deleted").

`Holiday` is small and doesn't need soft delete — hard-delete is fine.

## Reasoning

- **Restore UI requires undo**, so soft delete is mandatory for entities that have it.
- **Soft delete is cheap** and almost always pays off — accidental deletes are recoverable for free.
- **Indexes on `(userId, deletedAt)` keep "list active" queries fast** even with deleted rows piling up.

## Alternatives Considered

- **Hard delete with a separate "trash" table** — adds complexity for no real win. Soft delete is the standard pattern. Rejected.

## Consequences

- The repository layer must filter `deletedAt IS NULL` by default on list operations. A separate query is used for "list deleted."
- Every Prisma query that doesn't explicitly handle deleted rows needs the filter. **This is the kind of thing that's easy to forget** — keep it in the repository pattern so it's centralized.
- Some operations (cascading deletes, GDPR-style purge) need to know whether to count soft-deleted rows.

## Revisit If

- Privacy laws require true deletion (GDPR right to be forgotten). Then we add a `purgeDeleted` job that runs hard deletes on a schedule.
- DB table size becomes problematic (unlikely at POC scale).
