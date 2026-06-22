---
id: SPRINTS-INDEX
title: Sprint Plan and Index
status: stable
date: 2026-05-22
tags: [meta, planning]
related: [STATE]
---

# Sprints

Work is broken into **small, reviewable sprints**. Each sprint:

- Has its own file (`NN-slug.md`).
- Ends with a **checkpoint**: the user reads, runs, and approves before the next sprint starts.
- Lists concrete tasks, acceptance criteria, and any sync points.

The **detailed sprint file is created right before the sprint starts**, not all upfront. This lets us adjust based on what was learned in the previous sprint.

For the live status of which sprint is active, who owns it, and what's blocking, see [STATE.md](../STATE.md).

> ⚠️ The plan/table below is **historical** (Sprints 1–17, and the numbering predates the
> dashboard/scheduling work). The canonical wave/sprint log — including **Sprints 18–22**
> (KIMS onboarding, scheduling, manager insights, media pipeline) — is the root
> [`Wavesprint.md`](../../../Wavesprint.md). Detail files here exist only up to Sprint 17.

---

## Sprint Plan (Overview)

| # | Sprint | Owner Pattern | Status | Detail file |
|---|---|---|---|---|
| 01 | Alignment docs | Agent solo | ✅ complete | [01-alignment-docs.md](./01-alignment-docs.md) |
| 02 | Repo setup & dev tooling | **Together with user** | ⏸ ready to start | [02-repo-setup.md](./02-repo-setup.md) |
| 03 | Foundation infra | Agent solo, user reviews | sketched only | *(TBD — created when approaching)* |
| 04 | Schema + Pure CRUD (no AI yet) | Agent solo, user reviews | sketched only | *(TBD)* |
| 05 | Voice intent service + `/voice/process` | Agent solo, user reviews | sketched only | *(TBD)* |
| 06 | Image processing + media attachments | Agent solo, user reviews | sketched only | *(TBD)* |
| 07 | Day Plan + Day Closure | Agent solo, user reviews | ✅ complete | [07-day-plan-closure.md](./07-day-plan-closure.md) |
| 08 | AI date intent + context enrichment + safety caps | Agent solo, user reviews | ✅ committed | [08-ai-date-intent-and-safety.md](./08-ai-date-intent-and-safety.md) |
| 09 | History activity feed (derived projection — POC scope per ADR-0024) | codex-session, parallel with [FE Sprint 09](../../../Task-List/.agents/sprints/09-history-activity-feed.md) | ✅ committed | [09-history-activity-feed.md](./09-history-activity-feed.md) |
| 10 | Target-date action + recommendation hygiene + closure text-only | claude-session, BE half of paired FE Sprint 10 | 🟡 in progress | [10-target-date-and-closure-text.md](./10-target-date-and-closure-text.md) |
| 11 | Alerts (was 10) | Agent solo, user reviews | 🚫 deferred | *(TBD)* |
| 12 | Polish (was 11) | Agent solo, user reviews | sketched only | *(TBD)* |

**"Sketched only"** means the sprint goal is known but the detailed task breakdown isn't written yet. We create the detail file when we approach the sprint — usually as the last act of the previous sprint's checkpoint, so the user can sanity-check it before kickoff.

---

## Working Style (Per the Approved Plan)

- **Small, reviewable sprints.** Each ends in a checkpoint.
- **Plan next 1–2 sprints in detail.** Later ones stay sketched. Don't over-plan.
- **Web-research current docs** for Vertex AI SDK, GCS SDK, multer alternatives, etc. — training data is from Jan 2026 and the ecosystem moves.
- **Sync points are explicit.** Before installing deps, before scaffolding a folder, before introducing a new pattern — confirm with the user first. Especially in Sprint 2 (together).
- **`/simplify` at every code-touching sprint's checkpoint.** This is the quality gate ([ADR-0019](../decisions/0019-deferred-tests.md)).

---

## Sketches for Sprints 3–9

Just enough to know what's coming. **Don't treat these as authoritative** — they get rewritten into detailed task lists when we approach each one.

### Sprint 3 — Foundation infra
- `src/config/env.ts` (zod-validated env)
- `src/lib/errors.ts` (AppError hierarchy)
- `src/middleware/auth.ts` (stub reading `X-User-Id`)
- `src/app.ts` (`createApp()` factory)
- `src/index.ts` (signal handlers, graceful shutdown)
- `/livez`, `/readyz` endpoints
- (Logger + request IDs deferred per [ADR-0018](../decisions/0018-deferred-logging.md))

### Sprint 4 — Schema + Pure CRUD (no AI)
- Full Prisma schema (per [ARCHITECTURE.md](../ARCHITECTURE.md))
- First migration + seed (one User, one org)
- Repository layer
- Tasks / Notes / Holidays CRUD via routes + controllers + services
- Checkpoint: working conventional to-do app via curl

### Sprint 5 — Voice intent service + `/voice/process`
- **Web-research current `@google-cloud/vertexai` API first**
- `src/lib/vertex.ts` (client + prompt templates)
- `src/lib/storage/` (BlobStorage interface + GCS impl)
- `voiceIntent.service.ts` (shared intent classifier)
- `/voice/process` route
- Manual curl test with a real audio clip + `/simplify` pass

### Sprint 6 — Image processing + media attachments
- `/images/process` route
- `/tasks/:id/media` endpoints
- Storage adapter exercised end-to-end
- **This is the earliest sprint that blocks on GCS credentials**

### Sprint 7 — Day Plan + Day Closure
- `/day-plan/submit` (snapshot)
- `/day-closure/submit` (reuses voice intent service + AI feedback call)

### Sprint 8 — Alerts + History
- Alerts CRUD + `/alerts/generate` (AI)
- `/history` search across tasks + notes

### Sprint 9 — Polish
- README with run instructions
- Final type-strictness pass
- Dead code removal
- Final `/simplify` + `/review` pass
