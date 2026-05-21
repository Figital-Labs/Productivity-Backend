---
id: ADR-0012
title: AI outputs persisted write-once
status: accepted
date: 2026-05-22
tags: [ai, schema]
supersedes: null
related: [ADR-0002, ADR-0003]
---

# ADR-0012: AI Outputs Persisted Write-Once

## Context

Every Vertex call costs tokens and produces output that the user sees. If the user reopens a task to look at its `aiFeedback`, do we regenerate it from scratch or show what they originally saw?

## Decision

Persist every AI output **write-once**. Don't regenerate.

- `VoiceInteraction.transcript` and `VoiceInteraction.actions` — written once.
- `ImageExtraction.actions` — written once.
- `DayClosureSubmission.aiFeedback` — written once.
- `Task.aiFeedback` — written once (populated during day-closure).

If a Vertex call fails partway through, we re-run the whole flow; we don't try to patch partial results.

## Reasoning

- **Reopening a task should show the same AI feedback the user originally saw**, not a regenerated one. Inconsistent outputs are confusing.
- **Costs Gemini tokens only once per artifact.**
- **Required for audit trails** (manager review in multi-tenant future).
- **Lets us A/B different prompt versions** without breaking existing data — old rows show old prompts' output.

## Alternatives Considered

- **Regenerate on demand** — cheap disk, expensive Gemini bill, inconsistent UX. Rejected.
- **Persist transcripts only, regenerate summaries** — half-measure that causes confusion when summaries differ between views. Rejected.

## Consequences

- The schema has dedicated tables for AI artifacts (`VoiceInteraction`, `ImageExtraction`, `DayClosureSubmission.aiFeedback`).
- Stored as JSON for flexibility — we can change the prompt shape without migrating the DB.
- Re-running an AI flow creates a new row, not updates an existing one. Old rows are kept (history).
- If a Vertex call fails, the row isn't written. The frontend gets an error response and can retry — `Idempotency-Key` (see [ADR-0017](./0017-idempotency-keys.md)) ensures retries don't double-write.

## Revisit If

Never. Write-once is correct.
