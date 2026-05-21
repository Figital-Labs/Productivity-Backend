---
id: ADR-0007
title: Layered architecture (routes → controllers → services → repositories)
status: accepted
date: 2026-05-22
tags: [architecture]
supersedes: null
related: [ADR-0006, ADR-0008]
---

# ADR-0007: Layered Architecture

## Context

For a 30-LOC template, throwing everything into `index.ts` is fine. For a 5k-LOC service with AI integration, repository methods, multi-tenant authorization, and a half-dozen endpoint groups, it isn't.

This POC will land somewhere between those scales. We want structure that supports growth without over-engineering for it.

## Decision

Standard 4-layer split:

```
HTTP request
    ↓
routes/       ← HTTP framing (parse req, format response, status codes)
    ↓
controllers/  ← orchestrate services
    ↓
services/     ← business logic, framework-agnostic
    ↓
repositories/ ← the ONLY place Prisma is called
    ↓
Postgres
```

**Dependencies point only inward.** Routes depend on controllers; controllers on services; services on repositories. The reverse is forbidden.

Additional cross-cutting:
- `schemas/` — zod schemas. The source of truth; types are inferred from them.
- `middleware/` — auth, errors, idempotency, upload handling.
- `lib/` — shared infrastructure (prisma client, vertex client, storage, errors, logger).
- `utils/` — pure helpers (e.g., `canAccess(user, resource)`, date math).

## Reasoning

- **Business logic in services is testable** without booting an Express app.
- **Repository pattern means adding multi-tenant `WHERE orgId = ?` is one line per entity**, not a refactor.
- **Standard pattern** — easy for new hires (or future AI sessions) to navigate.
- **A service must not import Express types.** A repository must not call Vertex. These constraints catch wrong assumptions at compile time.

## Alternatives Considered

- **Flat structure (everything in `index.ts`)** — fine at 30 LOC, painful past 500. Rejected.
- **NestJS-style decorators + DI container** — strong boundaries via the framework, but overkill for POC scale. Reversible later if needed.
- **Hexagonal / Clean Architecture with strict ports** — too much ceremony for POC. The 4-layer split is the 80/20.

## Consequences

- New endpoints touch 4 files (route + controller + service + repo) by default. This is acceptable overhead — each file is small and focused.
- The `canAccess(user, resource)` helper sits in `utils/auth.ts` and is called by services. For POC it returns `true`. When hierarchy arrives ([ADR-0008](./0008-stub-auth.md)), that one function gets logic.
- Named exports only ([CONVENTIONS](../CONVENTIONS.md)) — keeps refactoring clean.

## Revisit If

- Codebase grows past ~5k LOC and we need stronger module boundaries (then look at NestJS or hex architecture).
- The 4-layer split feels like obvious bloat on simple endpoints — in which case we relax it case-by-case, not abandon it globally.
