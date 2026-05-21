---
id: ADR-INDEX
title: Architectural Decision Records — Index
status: stable
date: 2026-05-22
tags: [meta, index]
---

# Architectural Decision Records (ADRs)

This directory holds the **why** behind every architectural choice in the codebase. Each ADR is a single decision with stable ID (`ADR-NNNN`).

## How ADRs Work

- **Stable IDs**: `ADR-0001` etc. Never renamed, never renumbered.
- **Append-only**: once an ADR is `status: accepted`, **do not edit it**. If the decision changes, create a new ADR that supersedes the old one.
- **Status lifecycle**: `proposed → accepted → (optionally) superseded` or `deprecated`.
- **Cross-references**: ADRs link to each other via the `related` field in frontmatter.

## Adding a New ADR

1. Check this index for the next sequence number (currently `0021`).
2. Claim it in `STATE.md` to avoid races with parallel agents.
3. Create `00NN-slug.md` with frontmatter (use existing ADRs as templates).
4. Add a row to the index below.

## Superseding an ADR

1. Write a new ADR with the next sequence number.
2. Set new ADR's `supersedes` field to the old ADR's ID.
3. Edit the old ADR's frontmatter to change `status: accepted` → `status: superseded`. (This is the ONLY allowed edit to an accepted ADR.)
4. Update this index.

## Index

| ID | Title | Status | Tags |
|---|---|---|---|
| [ADR-0001](./0001-vertex-ai.md) | Use Vertex AI as the AI provider | accepted | ai, infrastructure |
| [ADR-0002](./0002-multimodal-gemini.md) | Multimodal Gemini in one call (no separate STT) | accepted | ai |
| [ADR-0003](./0003-voice-intent-classification.md) | General-purpose voice endpoint with intent classification | accepted | ai, api |
| [ADR-0004](./0004-duplicate-handling.md) | Duplicate handling: always create + flag + priority bump | accepted | ai, product |
| [ADR-0005](./0005-recommendation-pattern.md) | Recommendation pattern for ad-hoc work | accepted | ai, product, ux |
| [ADR-0006](./0006-ai-sugar-on-crud.md) | AI is sugar on conventional CRUD | accepted | architecture |
| [ADR-0007](./0007-layered-architecture.md) | Layered architecture (routes → controllers → services → repositories) | accepted | architecture |
| [ADR-0008](./0008-stub-auth.md) | Stub auth via `X-User-Id` header, multi-tenant-ready schema | accepted | auth, schema |
| [ADR-0009](./0009-gcs-storage.md) | GCS from day 1 behind BlobStorage interface | accepted | storage, infrastructure |
| [ADR-0010](./0010-per-user-timezone.md) | Per-user timezone, default `Asia/Kolkata` | accepted | schema, ux |
| [ADR-0011](./0011-submit-snapshot.md) | Submit semantics: soft lock with immutable snapshot | accepted | schema, product |
| [ADR-0012](./0012-ai-output-persistence.md) | AI outputs persisted write-once | accepted | ai, schema |
| [ADR-0013](./0013-soft-delete.md) | Soft delete via `deletedAt` | accepted | schema |
| [ADR-0014](./0014-prompt-context-pagination.md) | Prompt context: top 20–100 pending tasks (not full list) | accepted | ai |
| [ADR-0015](./0015-api-versioning.md) | API versioning under `/api/v1/...` | accepted | api |
| [ADR-0016](./0016-zod-validation.md) | Zod for all input validation | accepted | api, types |
| [ADR-0017](./0017-idempotency-keys.md) | `Idempotency-Key` header on mutating POSTs | accepted | api, reliability |
| [ADR-0018](./0018-deferred-logging.md) | Deferred: structured logging (use `console.*` for POC) | accepted | observability, deferred |
| [ADR-0019](./0019-deferred-tests.md) | Deferred: automated tests (manual curl at checkpoints) | accepted | testing, deferred |
| [ADR-0020](./0020-deferred-openapi.md) | Deferred: OpenAPI / Swagger spec generation | accepted | api, deferred |
