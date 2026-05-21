---
id: ADR-0020
title: Deferred — OpenAPI / Swagger spec generation
status: accepted
date: 2026-05-22
tags: [api, deferred]
supersedes: null
related: [ADR-0016, ADR-0019]
---

# ADR-0020: Deferred — OpenAPI / Swagger Spec

## Context

A common backend practice is to expose `/docs` (Swagger UI) generated from machine-readable API specs. With zod schemas already in place ([ADR-0016](./0016-zod-validation.md)), we could use `@asteasolutions/zod-to-openapi` to derive an OpenAPI spec automatically.

For the POC, the frontend team works directly from the route files. We don't have external SDK consumers yet.

## Decision

**Deferred.** No `/docs` route, no OpenAPI generation, no Swagger UI for POC. Frontend team reads route files (or ARCHITECTURE.md) directly.

Per the user: *"we are not implementing the openapi spec files but when we are writing code we should still write the good quality code and scalable code."* OpenAPI is tooling we'd add for external SDK generation; not POC-critical.

## Reasoning

- **Frontend team reads source.** They don't need codegen.
- **OpenAPI generation adds tooling** (`@asteasolutions/zod-to-openapi`, swagger-ui-express). Not a lot of code, but more dependencies and one more thing to maintain.
- **The zod schemas are already there.** Generating OpenAPI later is mechanical — no work is lost by deferring.

## Alternatives Considered

- **Add it now since zod is already present** — a half-day of work for a feature with no immediate consumer. Rejected.

## Consequences

- API documentation lives in [ARCHITECTURE.md](../ARCHITECTURE.md) for now (human-maintained).
- When we add OpenAPI back, the zod schemas become the source of truth — ARCHITECTURE.md becomes derived.

## Revisit If

- Client wants codegen'd SDKs for their integration team.
- Frontend team requests it.
- Multi-team consumption begins (e.g., another internal service calls our API).

## When We Add It Back

Recommended setup:
- `@asteasolutions/zod-to-openapi` to derive specs from existing zod schemas.
- `swagger-ui-express` to serve `/docs` in non-prod environments.
- Auto-publish the spec JSON at `/openapi.json` for consumer tooling.
