---
id: ADR-0003
title: General-purpose voice endpoint with intent classification
status: accepted
date: 2026-05-22
tags: [ai, api]
supersedes: null
related: [ADR-0002, ADR-0004, ADR-0005, ADR-0006]
---

# ADR-0003: General-Purpose Voice Endpoint with Intent Classification

## Context

A user dictating mid-day might say *"I finished morning rounds, the chart review is now urgent, and I need to call Dr. Smith."* That single sentence triggers three different intents — complete + priority_update + create — on three different tasks.

Naive design: one endpoint per intent (`/voice/create-task`, `/voice/complete-task`, `/voice/update-priority`). But that forces the frontend to pre-classify intent, which it can't reliably do without running Gemini itself.

## Decision

A single `POST /voice/process` endpoint handles **all** voice-driven actions. Gemini classifies intent per phrase. Backend executes each action via repository methods.

Response shape:

```json
{
  "transcript": "...",
  "actions": [
    { "type": "created",          "task":   {...} },
    { "type": "priority_updated", "taskId": "...", "newPriority": "..." },
    { "type": "completed",        "taskId": "..." },
    { "type": "partial",          "taskId": "...", "notes": "..." }
  ],
  "recommendations": [
    { "title": "...", "priority": "...", "reasoning": "..." }
  ]
}
```

Intent classification cues:
- *"I finished X"* / *"X is done"* → `completed`
- *"X is urgent"* / *"ASAP"* / *"high priority"* → `priority_updated`
- *"I need to do X"* / *"add X"* → `created`
- *"halfway through X"* / *"got partway through X"* → `partial`
- Ambiguous mentions go to `recommendations` (see [ADR-0005](./0005-recommendation-pattern.md))

## Reasoning

- **Matches how users actually speak.** Multiple intents in one breath, mixed freely.
- **One endpoint, one prompt, one round trip.** No frontend pre-classification.
- **Day closure is a special case** of this — same engine, plus a feedback-summary call.

## Alternatives Considered

- **Separate endpoints per intent** — forces frontend to pre-classify, which is the very problem Gemini is here to solve. Rejected.

## Consequences

- The voice intent service is **shared** between `/voice/process` and `/day-closure/submit`.
- The prompt is more complex (cue-word recognition for 4 intents + recommendation bucket).
- Mid-day completion is allowed via voice ("I finished X" works any time of day).

## Revisit If

- Gemini's intent classification proves unreliable in practice (tracked via user complaints about wrong actions).
- The single prompt grows so complex it produces worse results than smaller targeted prompts would.
