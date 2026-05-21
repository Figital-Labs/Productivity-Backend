---
id: ADR-0004
title: Duplicate handling — always create, flag reason, bump priority on urgency cues
status: accepted
date: 2026-05-22
tags: [ai, product]
supersedes: null
related: [ADR-0003]
---

# ADR-0004: Duplicate Handling

## Context

When a user dictates new tasks mid-day, some of them may overlap with already-pending tasks. *"I still need to do the patient chart review and call Dr. Smith"* — if "patient chart review" already exists in today's plan, what do we do?

This was a real product decision the user pushed back on. They were clear that **re-mentioning a task isn't necessarily an error** — the user might genuinely mean it as a second occurrence (e.g., "check on patient X" happens twice a day, morning and evening).

## Decision

When AI detects overlap between dictated content and an existing pending task:

1. **Always create the new task** (don't suppress it).
2. Return the new task with a `reason` field explaining why we noticed the overlap.
3. Separately, **if the user signaled urgency** (*"ASAP"*, *"it's urgent now"*, *"high priority"*), **also bump the priority** of the existing similar task.
4. No `possibleDuplicateOf` metadata field on the schema (YAGNI — nothing reads it).

## Reasoning

- **Silently dropping would feel buggy.** *"I just said that, why didn't it appear?"*
- **The user re-mentioning is a signal.** They cared enough to say it again. Capture that — either as a separate occurrence or as a priority bump.
- **Two separable signals**: *intent* (create vs update) and *content* (similar vs new). They're orthogonal. The AI can decide both.

| | Content matches existing | Content is new |
|---|---|---|
| **Create intent** (*"I need to do X"*) | Create new + flag overlap | Just create new |
| **Update intent** (*"X is urgent"*) | Update existing priority | Falls back to create |

## Alternatives Considered

- **Silently skip duplicates** — clean UX but obscures user intent. Bad if user actually meant a repeat occurrence. Rejected.
- **Return everything with a `possibleDuplicateOf` metadata field** — adds a field nobody reads. YAGNI. Rejected after user pushback.
- **Ask the user to confirm via UI** — requires frontend cooperation we don't have. Out of scope.

## Consequences

- Duplicate tasks are not blocked. If users complain about list clutter, that's a UX problem to solve in the frontend (show similar tasks together, offer merge).
- The AI's prompt includes a `reason` field requirement for create actions when overlap is detected.
- Priority bumps happen automatically when urgency words appear.

## Revisit If

- Users complain that they're getting too many duplicates and want the AI to be more aggressive about merging.
- Frontend team adds a "merge tasks" feature and wants metadata hints.
