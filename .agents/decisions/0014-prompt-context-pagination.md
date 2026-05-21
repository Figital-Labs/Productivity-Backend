---
id: ADR-0014
title: Prompt context — top 20–100 pending tasks (not full list)
status: accepted
date: 2026-05-22
tags: [ai]
supersedes: null
related: [ADR-0003, ADR-0004]
---

# ADR-0014: Prompt Context — Top 20–100 Pending Tasks

## Context

To classify intent correctly ([ADR-0003](./0003-voice-intent-classification.md)) and detect duplicates ([ADR-0004](./0004-duplicate-handling.md)), the AI prompt needs to know what tasks already exist for the user. The naive approach: send ALL pending tasks. That doesn't scale — a user with 200 open tasks would inflate every prompt.

## Decision

When building the Vertex prompt, send the **top 20–100 pending tasks** for the user, ranked by (recency + priority). Don't send the full list.

Exact number: configurable per call, default 50. Bounded by the prompt size budget.

## Reasoning

- **Bounds prompt size predictably.** No runaway token bills.
- **A user with 200 open tasks has an organization problem, not a backend problem.** We don't optimize for that case.
- **Most relevant tasks are recent + high-priority** — exactly what the user is likely to refer to.
- **The user explicitly endorsed this approach** during the planning conversation.

## Alternatives Considered

- **Send everything** — unbounded prompt size. Rejected.
- **Send only today's tasks** — too narrow. The user might refer to tasks from yesterday or earlier in the week. Rejected.
- **Send all, but compress with embeddings** — premature optimization for POC. Rejected.

## Consequences

- The repository layer exposes `findRecentPendingTasks(userId, limit)`.
- A user with 200+ tasks may have older tasks omitted from context, which means the AI might fail to recognize them and create duplicates. Acceptable trade-off — see Reasoning.
- If the limit needs tuning per endpoint, do it via the service layer (don't bake into the repository).

## Revisit If

- Users routinely have more pending tasks than fit and complain about missed matches.
- Token costs grow problematic and we need to *reduce* the limit.
