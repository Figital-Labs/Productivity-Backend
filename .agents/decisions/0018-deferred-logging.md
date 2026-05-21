---
id: ADR-0018
title: Deferred — structured logging (use `console.*` for POC)
status: accepted
date: 2026-05-22
tags: [observability, deferred]
supersedes: null
related: []
---

# ADR-0018: Deferred — Structured Logging

## Context

Production-grade Node services use structured logging (pino, winston) with JSON output, log levels, request IDs propagated via AsyncLocalStorage, and a log-aggregation backend (Stackdriver, Datadog, ELK).

For POC scale (single user, single laptop), plain `console.log` / `console.error` is sufficient. Pino + AsyncLocalStorage + pino-http is real infrastructure work for a problem we don't have yet.

## Decision

**Deferred.** Use plain `console.log` / `console.error` for POC. No pino, no structured JSON, no request IDs.

The user explicitly called this one as over-engineering during the planning phase. *"differ the loggin for now but we need in future.."*

## Reasoning

- **Single user, single developer.** Logs aren't a debugging bottleneck yet.
- **Pino + AsyncLocalStorage + request IDs is real infrastructure work.** Not worth doing until we have multi-user / production / staging.
- **Request IDs serve logging.** Without logging, request IDs have no place to go — defer them together.

## Alternatives Considered

- **Add pino now** — about a half-day of work for a feature with no immediate beneficiary. The user pushed back; they're right.

## Consequences

- `console.log` and `console.error` are fine for the POC. No "no `console.*`" lint rule.
- Logs are not parseable. That's OK at POC scale.
- **When we add it back**: install `pino` + `pino-http`, add AsyncLocalStorage-based request ID middleware, configure log level via env (`LOG_LEVEL=info`), ship to whatever log backend we end up with.

## Revisit If

- First deploy to a non-laptop environment (staging, production).
- Debugging stops being trivial with `console.*` (e.g., concurrent requests interleaving makes logs unreadable).
- The user explicitly asks for it.
