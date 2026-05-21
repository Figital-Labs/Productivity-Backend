---
id: ADR-0002
title: Multimodal Gemini in one call (no separate STT)
status: accepted
date: 2026-05-22
tags: [ai]
supersedes: null
related: [ADR-0001, ADR-0003]
---

# ADR-0002: Multimodal Gemini in One Call (No Separate STT)

## Context

The voice flow needs both **transcription** (audio → text) and **task extraction** (text → structured intents). The naive design is a pipeline: dedicated Speech-to-Text → LLM. Vertex actually has separate `speech.recognize` and `gemini.generateContent` endpoints we could chain.

But Gemini 2.5 Flash is multimodal — it accepts audio (and images) directly as input. So we can do both steps in one call.

## Decision

Send audio (and images) **directly to Gemini 2.5 Flash via Vertex** as multimodal input. Get back transcript and structured output (extracted tasks, action classifications) in one call.

## Reasoning

- **Half the round-trip latency.** One API call instead of two.
- **One SDK, one auth, one billing line.** Simpler operationally.
- **Quality is comparable** for single-speaker dictation (which is all we care about for POC).

## Alternatives Considered

- **Vertex Speech-to-Text → Vertex Gemini** — separate STT call, then LLM call. More code, more failure modes, slower, no quality win for our use case.

## Consequences

- The voice prompt to Gemini includes BOTH "transcribe this audio" AND "for each phrase, classify intent." The output is structured JSON with both the transcript and the actions.
- For long audio (meetings), this won't scale — Gemini has input-size limits. **But meetings are deferred** ([SCOPE.md](../SCOPE.md)), so this isn't a current concern.
- The same call accepts image inputs too — used for the morning bundled input case (voice + image OCR in one shot).

## Revisit If

- Meetings come back into scope (multi-speaker overlap is where dedicated STT shines).
- Audio quality measurably suffers vs dedicated STT.
- Gemini's input-size limit becomes a bottleneck for our actual audio lengths.
