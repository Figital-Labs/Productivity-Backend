---
id: ADR-0017
title: `Idempotency-Key` header on mutating POSTs
status: accepted
date: 2026-05-22
tags: [api, reliability]
supersedes: null
related: [ADR-0012]
---

# ADR-0017: `Idempotency-Key` Header on Mutating POSTs

## Context

Mobile networks are flaky. A user submits a day plan; their network drops mid-request; the client retries; we double-submit. Same for voice processing (which is expensive — would double the Vertex bill).

The Stripe-popularized pattern: clients send an `Idempotency-Key` header, server stores `(key, response)` and returns the cached response on replay.

## Decision

All mutating POSTs accept an optional `Idempotency-Key` header. Backend stores `(key, response)` and returns the cached response on replay within a 24h TTL.

For POC: store the map **in-memory** (a single Node process). This is unsafe across pods / restarts but fine for the single-process POC.

```typescript
// src/middleware/idempotency.ts
const cache = new Map<string, { response: unknown; expiresAt: number }>();
```

Mutating endpoints check the cache first; cache hit → return the cached response; cache miss → process normally and cache the result.

## Reasoning

- **Mobile flakiness is real.** Without idempotency, "submit day plan" can become "submit day plan twice" on retry.
- **Vertex calls are expensive.** Replaying a `/voice/process` request would double the token bill.
- **Standard pattern.** Stripe, Square, Plaid all use it.
- **In-memory is fine for POC.** Single process, single user, single laptop.

## Alternatives Considered

- **No idempotency, "frontend should dedupe"** — fragile. Network retries happen at layers the frontend doesn't fully control.
- **Redis from day 1** — adds infra dependency for a feature with one user. Defer.

## Consequences

- Frontend should generate a UUID per mutating action and send it. Without the header, mutations are not deduplicated — that's the frontend's risk.
- The in-memory map grows with usage. TTL cleanup happens lazily on each check.
- When we go multi-pod, swap the in-memory Map for Redis (one-file change in the middleware).

## Revisit If

- Multi-pod deployment (must use Redis or similar).
- Memory pressure from idempotency cache (set a stricter TTL).
