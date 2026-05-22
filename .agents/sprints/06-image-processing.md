---
id: SPRINT-06
title: Sprint 6 — Image processing (`/images/process`)
status: in_progress
owner: claude-session
started: 2026-05-22
completed: null
tags: [sprint, ai, vertex, image, ocr]
related: [ARCHITECTURE, ADR-0001, ADR-0003, ADR-0005, SPRINT-05]
---

# Sprint 6 — Image processing (`/images/process`)

## Goal

Ship `POST /images/process` — multipart image upload → Gemini 2.5 Flash Vision → OCR + intent classification → returns `{ extractedText, actions, recommendations }` → persists `ImageExtraction` audit row.

Primary use case: **user photographs a paper task list** (handwritten or printed). Gemini reads the list, classifies each item into create/complete/etc. against existing tasks, and routes ambiguous items to recommendations.

The flow is **structurally identical to voice** from Sprint 5 — different input modality, slightly different prompt (OCR-flavored), same action/recommendation contract, same dispatch into the Sprint 4 repository layer.

## Audio storage backfill + task media — explicitly deferred

Per user decision 2026-05-22 (after considering three options), Sprint 6 is **image processing only**:

- `VoiceInteraction.audioUrl` stays nullable; no backfill
- `BlobStorage` interface not built yet
- `POST /tasks/:id/media` (attach) not built
- `DELETE /tasks/:id/media/:mediaId` (detach) not built
- `POST /uploads` general endpoint not built

These land in Sprint 7 alongside day-plan / day-closure when GCS bucket + IAM are confirmed ready. Image bytes for `/images/process` go inline to Gemini just like audio did — no disk, no cloud, no persisted bytes for the source media.

`ImageExtraction.imageUrl` becomes nullable in this sprint (one-line migration), matching the audioUrl pattern.

## Non-goals (deferred)

- Audio storage backfill → Sprint 7
- `BlobStorage` interface + GCS impl → Sprint 7
- `/tasks/:id/media` attach + detach → Sprint 7
- Day plan / closure → Sprint 7
- Multimodal fusion (audio + image in one request) → revisit if usage demands
- Image preprocessing (resize, deskew, denoise) — defer until model output quality demands it

## Sync points (where I pause for you)

1. **Before writing the image prompt** — show you the prompt + how it differs from voice-intent. Prompt for OCR is the highest-leverage decision in this sprint.
2. **Before wiring controller/route** — quick layered-shape check (same shape as voice, so probably quick).
3. **Smoke test** — you provide a real photo of a handwritten/printed task list. PNG/JPEG/WEBP all fine. Or I can generate a synthetic one if you'd rather.

## Tasks

### 6.1 — Schema migration
- `ImageExtraction.imageUrl String` → `String?`
- Add `ImageExtraction.extractedText String?` — the OCR'd text (image-flow analogue of `VoiceInteraction.transcript`)
- `npx prisma migrate dev --name image_extraction_extracted_text`
- One small migration.

### 6.2 — Zod schema for image-extraction output
- `src/schemas/image-extraction.schema.ts`
- Reuses `voiceActionSchema` and `voiceRecommendationSchema` from Sprint 5 (same shape; rename the action types if needed to be modality-neutral, or keep as-is and import). Decision will be made during write — leaning toward keeping voice schemas as-is and importing, since the action shape genuinely IS identical.
- Output: `{ extractedText: string, actions: VoiceAction[], recommendations: VoiceRecommendation[] }`

### 6.3 — Image extraction prompt
- `src/lib/prompts/image-extraction.ts`
- Adapts the voice-intent prompt: same sections, same rules, but tailored for images of task sheets (handwritten + printed + whiteboard photos). Adds OCR-specific rules:
  - Process items in the order they appear on the page
  - Strike-throughs / checkmarks / "✓" / "DONE" mark items as completed
  - "URGENT" written in caps or with !!! → high priority
  - Items that look unrelated to tasks (signatures, dates, random doodles) → ignore, don't surface
- Same Hinglish-output rule + bilingual priority cues from voice-intent.

### 6.4 — Image upload middleware
- Extend `src/middleware/upload.ts` factory (already exists from Sprint 5) with an `imageUpload` preset.
- Limits: 15 MB max (smaller than audio's 25 MB — images are usually smaller, and very large images hurt Gemini latency more than they help).
- MIME whitelist: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`.

### 6.5 — Image repository
- `src/repositories/image.repository.ts`
- `create(data)` + `update(id, patch)` — mirrors voice.repository.ts. Adds `extractedText` field handling.

### 6.6 — Image extraction service (orchestrator)
- `src/services/image-extraction.service.ts`
- Same pattern as `voice-intent.service.ts`:
  1. Load pending tasks context (`taskRepo.listPending(user.id, 50)`)
  2. Create empty `ImageExtraction` row → grab id (for `sourceId`)
  3. Call `generateStructured` with prompt + inline image
  4. Dispatch each action (created → `taskRepo.create` with `sourceType: "image"` + `sourceId`; others → `taskRepo.update` after `taskService.getTask` ownership check)
  5. Final update of `ImageExtraction` with `extractedText`, `actions`, `recommendations`
  6. Return `{ imageExtractionId, extractedText, actions, recommendations }`
- Reuses `dispatchAction` shape from voice. **Open question to decide during write:** extract `dispatchAction` into a shared helper (e.g., `src/services/_action-dispatcher.ts`) or duplicate? Per "don't preempt the abstraction" I'd lean toward a tiny extracted helper since the duplication would be ~40 lines verbatim — that's past the threshold where DRY wins. Will call it out at write time.

### 6.7 — Controller + route + mount
- `src/controllers/image.controller.ts`
- `src/routes/images.routes.ts`
- `POST /api/v1/images/process` mounted in `src/routes/v1.ts`.

### 6.8 — Smoke test
- You provide (or I generate) a photo of a task list. PNG/JPEG/WEBP.
- Verify: extractedText reads the items, actions match items semantically against the pending list, ImageExtraction row persisted, sourceId chain works for created tasks.
- Error paths: wrong MIME (e.g., PDF) → 400; no file → 400; file too large → 413.

### 6.9 — `/simplify` pass (you decide whether to run it)
- Skipped at Sprint 4 + Sprint 5 checkpoints. Worth running here? Voice + image are very similar so duplication patterns are likely to surface.

## Acceptance Criteria

- `npm run typecheck` clean, `npm run lint` clean.
- Smoke test produces a valid response with at least one correctly-classified action.
- `ImageExtraction` row persisted with `extractedText`, `actions`, `recommendations`. `imageUrl` is null (per deferred storage decision).
- Created tasks carry `sourceType: "image"` + `sourceId` pointing to the `ImageExtraction` row.
- No Prisma calls outside repositories. No Express types in services or `src/lib/`.
- Existing voice flow still works (Sprint 5 smoke test repeatable).

## Open questions deferred to "revisit if"

- Multimodal fusion (single endpoint for audio + image + text together) — revisit if we observe users wanting cross-modal references
- Per-action confidence scores — already rejected ("model will fabricate") in Sprint 5; same answer here
- Image preprocessing pipeline (resize, contrast, deskew) — only if Gemini's raw output quality is poor on real client photos
