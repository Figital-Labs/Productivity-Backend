---
id: ADR-0001
title: Use Vertex AI as the AI provider
status: accepted
date: 2026-05-22
tags: [ai, infrastructure]
supersedes: null
related: [ADR-0002, ADR-0009]
---

# ADR-0001: Use Vertex AI as the AI Provider

## Context

The product needs an AI provider for transcription, image OCR, task intent classification, and feedback summarization. The user provided a GCP service account JSON for project `nth-rookery-341212`, which is configured for Vertex AI access.

A separate Google AI product exists — the **public Gemini API** at `ai.google.dev`, which uses a single API key. It's faster to set up but has lower rate limits and no IAM-grade auth.

## Decision

Use **Vertex AI** via `@google-cloud/vertexai`, authenticated with the GCP service account the user provided.

## Reasoning

- **Auth fits production grade.** Service account JSON with IAM roles, not an API key string. No "key in env" attack surface.
- **Single cloud, single credential.** Vertex AI + GCS both authenticate from the same service account.
- **The credential the user gave us is for Vertex.** Choosing the public API would mean asking for a different credential — friction.
- **Same models.** Vertex and the public API both expose Gemini 2.5 Flash. We're not giving up capability.

## Alternatives Considered

- **Public Gemini API (`ai.google.dev`, API key)** — easier setup (30 sec), generous free tier, but the key has to be guarded forever. Rejected: user has Vertex creds, no reason to introduce a second AI dependency.

## Consequences

- `.env` references `GOOGLE_APPLICATION_CREDENTIALS=./secrets/vertex-sa.json` instead of carrying an API key.
- Required env vars: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT=nth-rookery-341212`, `GOOGLE_CLOUD_LOCATION=us-central1` (or `asia-south1` depending on what's enabled).
- The service account JSON lives in `./secrets/` (gitignored).
- **Sprint 2** verifies connectivity with a hello-world script before any AI code is written.
- The Vertex SDK has been moving fast — always web-research the current API shape before writing code that uses it.

## Revisit If

- Vertex AI isn't enabled on the user's project and would take real time to enable.
- We need a feature only the public Gemini API has (rare).
