---
id: ADR-0015
title: API versioning under `/api/v1/...`
status: accepted
date: 2026-05-22
tags: [api]
supersedes: null
related: []
---

# ADR-0015: API Versioning Under `/api/v1/...`

## Context

Once the frontend has integrated against an endpoint, any breaking change requires either a coordinated frontend release or some form of versioning. Versioning is free now and saves coordination pain later.

## Decision

Every route is under `/api/v1/`. When we need a breaking change, we add `/api/v2/` alongside (don't break `v1`).

## Reasoning

- **Cheap insurance.** Costs zero to add `/api/v1/` to the route prefix.
- **Standard pattern.** Every major API does this.
- **Allows breaking changes without coordinating** — old clients keep working on v1; new clients adopt v2.

## Alternatives Considered

- **No versioning** — fine until the first breaking change, then painful. Rejected.
- **Header-based versioning** (`Accept-Version: v1`) — works but less discoverable; harder to curl. URL-based wins for our scale.

## Consequences

- The Express router mounts everything under `/api/v1/`.
- The health endpoints `/livez` and `/readyz` are NOT under `/api/v1/` — they're unversioned by convention (k8s convention; they're infrastructure, not API).

## Revisit If

Never. This is the default everywhere.
