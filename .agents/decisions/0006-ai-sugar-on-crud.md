---
id: ADR-0006
title: AI is sugar on conventional CRUD
status: accepted
date: 2026-05-22
tags: [architecture]
supersedes: null
related: [ADR-0003, ADR-0005, ADR-0007]
---

# ADR-0006: AI Is Sugar on Conventional CRUD

## Context

This is **the load-bearing principle of the architecture**, not a single technology choice.

The user was clear when describing the workflow: *"still we have to build those conventional to-do tasks, all of that."* The AI features (voice extraction, day-closure feedback, etc.) are ADD-ONS to a fully-functional conventional to-do app — not a replacement for it.

A user who never uses voice should still be able to use every feature of the app via type-and-tap.

## Decision

**Every AI-driven action calls the same repository methods that the manual CRUD endpoints use.** The AI layer is a thin wrapper that **decides what to do**; the repository layer **does it**.

This means:
- `POST /voice/process` (AI flow) → voice intent service → `taskRepo.create`, `taskRepo.updatePriority`, `taskRepo.markComplete`
- `POST /tasks` (manual flow) → task service → same `taskRepo.create`

The repository methods don't know whether they were called by AI or by a human. They just create / update / delete rows.

## Reasoning

- **A user who never uses voice can still use the app fully** via manual CRUD. The product remains usable if AI breaks or the user just prefers typing.
- **The AI never bypasses validation.** It can't write outside the data model the manual endpoints would.
- **If the AI is wrong, the user can correct manually** using the same endpoints.
- **Tests, observability, and debugging happen at the CRUD layer.** The AI layer is testable in isolation (mock Vertex; verify which repository methods were called with what args).
- **One source of truth per operation.** "Create a task" has exactly one implementation, and both paths flow through it.

## Alternatives Considered

- **Let the AI write to the DB directly** — would mean two paths to "create a task," with subtly different validation and side effects. Recipe for bugs. Rejected.
- **AI-only flows** (no conventional CRUD) — fails the basic usability test (what if the user doesn't want to speak right now? What if they need to fix a specific field?). Rejected.

## Consequences

**Practical implication for code structure:**
- Services for tasks, notes, etc. **have no AI awareness**. They expose pure CRUD methods.
- Voice/image services **call into** the task service, not the other way around.
- The dependency direction is: `routes → controllers → services (including voice service) → repositories`. The voice service is a peer of the task service, not above it.

## Revisit If

Never. This is foundational. If it ever feels constraining, the right move is to re-examine the specific case, not abandon the principle.
