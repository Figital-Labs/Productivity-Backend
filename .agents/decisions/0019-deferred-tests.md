---
id: ADR-0019
title: Deferred — automated tests (manual curl at sprint checkpoints)
status: accepted
date: 2026-05-22
tags: [testing, deferred]
supersedes: null
related: [ADR-0018, ADR-0020]
---

# ADR-0019: Deferred — Automated Tests

## Context

Production-grade Node services have vitest (or jest) for unit tests and supertest for integration tests. Integration tests against a real Postgres (via testcontainers) catch issues unit tests miss.

For POC scale, the API surface is still in flux. Tests written now would mostly be deleted as endpoints change shape. The bar for not-breaking-things during POC is "the dev exercising it manually."

## Decision

**Deferred.** No vitest, no supertest, no integration tests for POC. Manual `curl` checks at each sprint's checkpoint.

**Critical clarification (the user emphasized this):** deferring tests does **NOT** relax the code-quality bar. We use **`/simplify`** at sprint checkpoints to enforce strict types, clean structure, no dead code, no premature abstraction. That's the user-invocable quality gate.

## Reasoning

- **POC API surface will change.** Tests written now would mostly be deleted.
- **Manual exercise of a small surface is the right form of verification at POC scale.**
- **The `/simplify` skill is our quality gate** instead of CI.

## Alternatives Considered

- **Write a few critical-path tests now** — sounds reasonable but in practice the maintenance burden outweighs the value during a fast-iteration POC. Rejected; user pushed back.

## Consequences

- The `tests/` folder won't exist for POC.
- `package.json`'s `"test"` script stays as the placeholder `echo "Error: no test specified"`.
- **Every sprint that touches code runs `/simplify` at its checkpoint.** This catches the same kinds of issues tests would have caught (dead code, wrong abstractions, missing edge cases the reviewer would notice).
- **Manual curl test plans** are documented in each sprint file under "Checkpoint Verification."

## Revisit If

- Surface stabilizes (post-POC, pre-pilot). Then add: vitest for services, supertest for endpoints, testcontainers-postgres for integration.
- Bugs start escaping (signal that manual checking isn't enough).
- The user asks for tests.

## When We Add Tests Back

Recommended setup:
- **vitest** (faster than jest, native ESM)
- **supertest** for HTTP endpoint integration tests
- **testcontainers** for spinning up real Postgres per test run
- Mock Vertex SDK in tests — never make real Vertex calls in CI
