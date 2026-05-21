---
id: ADR-0005
title: Recommendation pattern for ad-hoc work (never auto-create)
status: accepted
date: 2026-05-22
tags: [ai, product, ux]
supersedes: null
related: [ADR-0003]
---

# ADR-0005: Recommendation Pattern for Ad-Hoc Work

## Context

During day closure, the user might mention doing work that **was never on the plan**: *"...and I also did emergency triage at 3pm — that wasn't planned."* Two options:

- (a) Auto-create the new task with `completed: true` so history is accurate.
- (b) Surface it to the user as a *suggestion* with explicit Add/Skip controls; only create if user confirms.

The user explicitly chose (b) and was right to.

## Decision

When the AI is unsure, OR when the user mentions doing work not on the plan, the AI returns it in a **`recommendations`** array. The backend **does not write it to the DB**. The frontend renders Add/Skip buttons; on Add, the frontend POSTs to `/tasks` via the normal create endpoint.

```json
{
  "actions": [ ... ],
  "recommendations": [
    {
      "title": "Emergency triage",
      "priority": "high",
      "completed": true,
      "reasoning": "User mentioned doing this at 3pm but it wasn't on today's plan"
    }
  ]
}
```

## Reasoning

This matches the universal pattern for state-mutating AI features across the industry:

- **Apple Reminders + Siri** always confirms: *"Got it. I'll add 'buy milk.' Sound good?"*
- **Gmail Smart Reply / Compose** suggests text, never auto-sends.
- **GitHub Copilot** suggests code, you accept with Tab — never auto-writes.
- **Sunsama** (end-of-day reflection app) asks "anything else today?" with an explicit add button.

The principle: **AI suggests, user confirms** — especially for actions that mutate state. Auto-creating tasks the user didn't ask to create is silently inserting state. That's the wrong default for any AI surface.

## Alternatives Considered

- **Auto-create the new task with `completed: true`** — keeps history accurate but violates the suggest-vs-act principle. Rejected after user pushback. They were right.

## Consequences

- The day-closure response shape has a `recommendedNewTasks` array.
- The same pattern is used for the morning voice flow when Gemini is unsure about a phrase.
- Backend's voice/image services are stricter — they only WRITE for high-confidence intents and KICK to recommendations for anything fuzzy.
- Frontend has the burden of rendering Add/Skip UI for recommendations. **The backend does not control this UX** — frontend can choose to ignore the recommendations entirely if it wants, and that's fine.

## Revisit If

- Recommendation pattern proves annoying in practice and users want auto-accept.
- Users complain that the AI is too conservative and not capturing things they wanted captured.
