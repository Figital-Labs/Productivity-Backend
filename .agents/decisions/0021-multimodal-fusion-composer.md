---
id: ADR-0021
title: Multimodal fusion composer (/process) — single Vertex call across audio + image + text
status: accepted
date: 2026-05-22
tags: [ai, architecture, multimodal]
supersedes: null
related: [ADR-0001, ADR-0003, ADR-0005]
---

# ADR-0021: Multimodal Fusion Composer (`/process`) — Single Vertex Call Across Audio + Image + Text

## Context

The morning composer flow can involve any combination of: voice dictation, a photo of a handwritten task sheet, and a typed paragraph. Sprints 5 and 6 shipped separate per-modality endpoints (`/voice/process`, `/images/process`). Sprint 7 shipped day-plan and day-closure. The Sprint-5 principle was "ship small first, observe, then ladder up."

After shipping those endpoints, two gaps surfaced:

1. **No text paragraph endpoint.** If a user typed a free-form Hinglish paragraph, the frontend had to manually split it into individual tasks and POST each one — losing the AI's ability to detect priority cues across the whole paragraph and handle fuzzy multi-task phrases.

2. **Frontend has to orchestrate multiple AI calls.** To send audio + image + text together, the frontend would need to fire three separate requests, handle three response shapes, deduplicate results, and stitch a coherent UI — all while managing partial failures. This defeats the "cohesive morning composer" experience.

The question was: do we add a fourth modality by composition (parallel calls, merge at the BFF), or do we do true fusion (one Vertex call sees everything at once)?

## Decision

True fusion via a single Vertex `generateContent` call — all provided modalities are bundled in the same request using `@google/genai`'s `InlineMedia` array. The endpoint is `POST /api/v1/process`.

Additionally, `POST /api/v1/text/process` is shipped as a standalone endpoint for the text-only case (mirrors the voice flow minus audio; separate `TextInteraction` audit model).

Each action and recommendation in the fusion response carries a `source: "voice" | "image" | "text"` field indicating which modality contributed it.

`transcript` and `extractedText` are **not** returned in the fusion response. This is a deliberate choice — see Reasoning below.

## Reasoning

**Why fusion (Option B) over parallel composition (Option A):**

- **Cross-modal grounding.** Gemini reads all modalities simultaneously, so "complete the third item I wrote" in audio can reference a task visible in the image. Parallel calls cannot ground across modalities.
- **One Vertex call → lower token cost and lower wall-clock latency.** A parallel approach would be three sequential or concurrent calls, each paying the full prompt + context overhead.
- **Single response shape.** The frontend makes one POST, gets one response, and renders one action list — simpler integration surface.
- **User mental model.** "Here's everything I have this morning" is one gesture, not three.

**Why drop `transcript` and `extractedText` from the fusion response:**

Top-level `transcript` and `extractedText` fields would invite the frontend to display or depend on them — and would tempt future backend code to use them as intermediate inputs (e.g., "OCR first, then classify the extracted text"). That cascade is dangerous: a hallucination in the OCR step would propagate silently into the classification step with no audit trail showing which step failed. By dropping both fields, we force all provenance into per-action `reasoning` (which the model writes inline at the time it makes the classification), eliminating the cascade risk entirely.

**Why the Sprint-5 deferral was the right call then, and why now is the right moment to ladder up:**

Sprint 5 shipped voice; Sprint 6 shipped image; Sprint 7 shipped day-plan/closure. Each sprint validated that the underlying mechanisms work (dispatcher, recommendation pattern, structured output, server-generated IDs, pending-task anchoring). Fusion inherits all of those safety mechanisms unchanged. Shipping fusion before those were proven would have made it harder to isolate bugs. Shipping it after gives us a stable floor.

## Alternatives Considered

- **Option A — Parallel composition:** Backend fires three separate Vertex calls and merges results before returning. Cheaper to implement; no cross-modal grounding; frontend ergonomics unchanged (still one API call). Rejected because cross-modal grounding is the key product differentiator and because the merge logic (deduplication, conflict resolution) would have to live somewhere — better in a purpose-built fusion prompt than in ad-hoc merge code.

- **Option C — Only ship `/text/process`, skip fusion:** Closes the paragraph gap without the multimodal complexity. Frontend would still need to write parallel-call logic for audio + image + text together. Rejected because the ergonomics gap was the primary user request, and `/text/process` alone doesn't address it.

## Consequences

- **Higher hallucination surface.** One bad input can affect the entire call. Mitigated by the recommendation pattern (ADR-0005): when the model is unsure, it returns `recommendations` not `actions`.
- **One more AI prompt to maintain.** The fusion prompt (`src/lib/prompts/unified-intent.ts`) is the fourth Vertex prompt in the codebase (alongside voice-intent, image-extraction, day-closure-feedback).
- **Per-modality failure cannot be isolated.** If Gemini chokes on a malformed audio attachment, the whole call fails — not just the audio portion. Per-action `source` tags help with post-hoc debugging.
- **New Prisma models.** `TextInteraction` and `UnifiedInteraction` are added; `AiSourceType` extended to `"voice" | "image" | "text" | "unified"`.
- **No new middleware complexity for text.** `/text/process` is JSON-only, no multer. The new `multiModalUpload` multer middleware for `/process` accepts both `audio` and `image` fields with per-field MIME filtering, reusing the existing `createUpload` factory pattern.

## Revisit If

- Per-modality failures can't be isolated and cause real UX pain (e.g., a bad image consistently ruins good audio input). In that case, move toward parallel composition with client-side merge.
- Cross-modal contradictions (audio says X, image shows ¬X) show systematic patterns that the recommendation pattern alone isn't catching. Add explicit contradiction-detection rules to the fusion prompt.
- Cost or latency of the fusion call is dominated by the audio attachment alone and users without audio report noticeably slower responses. In that case, route text-only and image-only requests through their dedicated endpoints instead.
- Multi-image or multi-audio per call becomes a real user request. Current scope is at most one of each.
