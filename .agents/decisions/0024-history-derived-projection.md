---
id: ADR-0024
title: History activity feed — derived projection over existing tables (POC scope only)
status: accepted
date: 2026-05-23
tags: [history, audit, architecture, poc-scope]
supersedes: null
related: [ADR-0001, ADR-0011, ADR-0012, SPRINT-09]
---

# ADR-0024: History Activity Feed — Derived Projection (POC Scope)

## Context

The original History screen (frontend Sprint 02 era) is a flat list of past tasks — useful for "find a task" but boring for "see what I did this week". Product direction 2026-05-23 reframes History as a **story-style activity timeline**: grouped cards per day showing batches like *"2 tasks created via voice", "5 tasks from your image scan", "Day Plan submitted"*, expandable to the individual task details.

The data needed for that timeline already exists across multiple tables — `Task` (`sourceType`, `createdAt`, `updatedAt`, `deletedAt`), `VoiceInteraction.actions`, `ImageExtraction.actions`, `TextInteraction.actions`, `UnifiedInteraction.actions`, `DayPlanSubmission`, `DayClosureSubmission`. None of those tables exist as a unified event stream; they're per-feature audit-flavored records.

Two ways to expose that as a timeline:

- **(A) Derived projection.** A single new endpoint queries the relevant tables, projects each row into a uniform `ActivityEvent`, merges + sorts by timestamp, returns.
- **(B) Proper audit log.** A new `TaskAuditEvent` table that every mutation writes to. The endpoint becomes a trivial single-table scan.

## Decision

Ship **(A) derived projection** for the POC. Do not introduce a new audit-log table. The endpoint is `GET /api/v1/activity?from=YYYY-MM-DD&to=YYYY-MM-DD` (`from`/`to` optional; default all-time).

This is an explicit POC-scoped decision with documented scale limits and a migration trigger. When those limits start to bite, migrate to (B); the frontend contract stays unchanged.

## Reasoning

**Why (A) over (B) right now:**

1. **Schema thrift.** No migration, no backfill question ("history starts now" vs. one-off projection of existing data), no decision on which existing rows to retroactively create events for.
2. **Faster validation loop.** We can ship the timeline UI + measure whether users actually like the "playbook" framing in one sprint instead of three. If the framing flops, we've avoided building the audit-log infrastructure.
3. **POC data scale doesn't feel (B)'s performance benefit.** Demo accounts have dozens to low hundreds of tasks. Querying 5-6 tables with date filters + indexes is sub-100ms easily at that scale.
4. **Frontend contract is approach-agnostic.** The `ActivityEvent[]` response shape is the same whether the backend derives it from 5 tables or reads it from 1. We can swap the implementation later without touching the UI.

**Why (B) is the right long-term answer:**

1. **State-toggle fidelity.** The current `Task` table only stores the *latest* `completed` / `isPartial` / `priority` state plus an `updatedAt` timestamp. If a user toggled complete → incomplete → complete, we only see the final state and the most recent timestamp. With (A), the "I un-completed it at 2pm" event is permanently invisible. With (B), every toggle becomes an event row.
2. **Performance ceiling.** Each `/activity` request under (A) queries 5-6 tables. At ~5K tasks per user (or ~50K events implied), the merge-sort path becomes a noticeable tail latency. Indexing helps but the JOIN-heavy projection is fundamentally slower than a single indexed scan.
3. **Future analytics.** Aggregate queries like "voice usage by day of week", "average tasks per AI batch", "drop-off after day-plan submit" all need an event table to be sane. Deriving them from 5 sources is doable but increasingly gnarly.

## Scale limits and migration trigger

**This approach is explicitly POC-only.** Migrate to (B) when ANY of the following becomes true:

- Single-user task count exceeds **~5,000 lifetime tasks** (P95 `/activity` latency starts to creep past ~250ms).
- We need to surface state-toggle events ("you marked X done then changed your mind") — (A) can't show those.
- We need real analytics endpoints that don't fit the projection cleanly.
- Compliance / audit demands a tamper-resistant event log (it would also need `createdAt` immutability + soft-delete-only semantics).

Migration path:

1. Add `TaskAuditEvent` table to Prisma schema.
2. Write Prisma middleware that intercepts `task.create / task.update / task.delete` and writes corresponding event rows (also voice/text/image/unified-interaction `create` calls).
3. One-off backfill script that reads existing rows + projects them as historical events (or just declare "history starts on migration day" — simpler).
4. Rewrite `activity.service.ts` to read from the new table.
5. Frontend unchanged.

## Out of scope for the POC timeline

- **Deletion events.** When a task is deleted, the user almost always wanted to. Surfacing "you deleted this task at 3pm" is noise more than signal. Skip in (A); reconsider for (B).
- **Partial-toggle and priority-change events.** Low signal at POC scale. Skip.
- **Holiday-toggle events.** Don't belong in task-activity. Skip.
- **Notes activity.** Notes have no UI per ADR-0001; no point putting them in History yet.

## Consequences

- **Positive:** ships in ~1 sprint backend + ~1 sprint frontend. No migration. Validates the UX before infrastructure investment.
- **Negative (accepted):** lossy on toggle history, performance ceiling around ~5K tasks. Both surface only if the POC succeeds at scale, which is a good problem.
- **Maintenance:** `activity.service.ts` will have a top-of-file comment block reproducing this ADR's scale-limit guidance, so future maintainers see it without leaving the code.
