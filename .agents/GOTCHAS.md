---
id: GOTCHAS
title: Footguns & Key Decisions (read before touching meetings, hierarchy, or AI)
status: stable
date: 2026-06-11
tags: [gotchas, decisions, ai, meetings, hierarchy]
related: [ARCHITECTURE, PRODUCT, DEVELOPMENT]
---

# Gotchas & Key Decisions

The non-obvious things you *will* trip over. Read it before debugging meetings, the
hierarchy, or the AI.

## Footguns

1. **`env.ts` uses `dotenv({ override: true })` on purpose.** A stale shell `DATABASE_URL`
   (pointing at localhost) once shadowed `.env` → `ECONNREFUSED`. Override makes `.env` win.
   Don't remove it. If the DB "won't connect," first check for a leftover shell env var.

2. **Meeting `/process` is a SYNCHRONOUS long HTTP call** (Vertex, timeout `AI_TIMEOUT_MS.meeting` = 20 min). On a PaaS proxy (Render), the *client* connection can be dropped while the backend keeps working → the meeting **does** finish (`processedAt` set), but the client sees an error. The backend is **idempotent** (`processedAt` lock → `MEETING_ALREADY_PROCESSED`). The frontend `ProcessingProgressModal` re-fetches `meetingsApi.get(id)` on error and treats a set `processedAt` as success. **Do not** "fix" this by removing the re-check or setting `maxRetries: 0` (retries push through flaky *connects*). This is not OOM — verify `processedAt` before blaming memory.

3. **Meeting uploads use multer `memoryStorage`** (buffered in RAM), up to **12 audio + 4 images @ 10MB each**. Big RAM spikes on the 512MB free tier. Audio is **never persisted** (streamed to Vertex inline). If you raise limits, watch memory.

4. **The team tree DUPLICATES co-managed people by design.** `getTeamTree` (`dashboard-tree.service.ts`) and `listManagedTree` (`team.service.ts`) render a person (and their subtree) under EACH of their managers — correct for the nested **display** (so every manager sees their full team in the matrix hierarchy). But any consumer that **flattens or counts** the tree MUST **dedupe by user id**, or you get inflated counts / duplicate picker entries. Current flat consumers already dedupe (`ManageSection` counts, `TeamDashboard` assignee pool). **New flat/count consumers must dedupe too** — this is the known fragility of the duplicate-then-dedupe approach.

5. **`Task.targetDate` is the scheduled day (when it lands on the assignee's list), NOT a deadline.** A deadline ("ready by tomorrow") belongs in `notes`. The meeting prompt enforces this; the UI label is **"Scheduled for"** (was "Due date"). Don't reintroduce deadline semantics into the date field.

6. **Speaker diarization is unreliable** (Gemini can't robustly tell voices apart or map them to people). Meetings attribute tasks by **spoken names**, not voice. Don't promise "who said what." Robust attribution would need dedicated STT (AssemblyAI/Deepgram/Google STT) + voice enrollment — a post-MVP project.

7. **The unified `/process` path is PARKED (dead).** Backend: `unified-process.{routes,controller,service}.ts` + `lib/prompts/unified-intent.ts`; the import+mount in `routes/v1.ts` are commented **together** (commenting only one trips `noUnusedLocals`). Frontend: `AiTaskModal.tsx` + `api/unified.ts` are `@ts-nocheck` and unmounted. Founder decision (Q-1). Leave parked; re-enable both `v1.ts` lines to restore.

8. **Alerts are dormant.** The `Alert` model exists but **no routes are wired**; the frontend shows "Coming soon." A prior frontend called Gemini **directly from the browser with an exposed key** — removed. If alerts return, route them through the backend.

9. **`npm run eval` makes real, paid Vertex calls** (needs creds; not in CI). Eval cases MUST use **held-out inputs** — never reuse a prompt's own worked examples, or you're testing memorization, not generalization (`eval/cases.ts` documents the held-out rule).

10. **Keep prompt JSON shape ↔ zod schema in sync.** AI calls use `responseJsonSchema` (controlled structured output) built from the zod schema, then re-parse. If you change a prompt's output block, change the schema (and vice versa).

11. **Graceful degradation:** morning-brief & day-closure return a deterministic fallback on AI failure (never 500). Capture flows still surface a 502 after retries (a soft `degraded` flag is a noted follow-up, not yet built).

## Key decisions (rationale lives in `decisions/` ADRs where noted)
- **AI is sugar on CRUD** (ADR-0006) and **recommendations need user confirmation** before creating tasks (ADR-0005). Meetings route ALL actions through recommendations.
- **Layered architecture, Prisma only in repositories** (ADR-0007). **Idempotency keys** on mutating POSTs (ADR-0017).
- **Resilience layer** added to every AI call site: retry-with-backoff on recoverable failures + per-attempt timeout + per-surface temperature/thinkingBudget + raw-output logging (`vertex.ts` / `ai-config.ts` / `ai-log.ts`).
- **Prompts converged** onto shared-rules constants + a hospital vocabulary block; reasoning/copy is **first-person and anti-leak** (no "AI", no ids/rule-numbers).
- **Meeting summary** upgraded to a structured Fireflies-style format; the **organizer is merged into the attendees list neutrally** (no special weighting — avoids over-assigning to them); `selfUserId` only resolves first-person ("main kar lunga").
- **`tips`** was removed from day-closure feedback end-to-end.
