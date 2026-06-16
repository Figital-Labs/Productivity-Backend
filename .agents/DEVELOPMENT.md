---
id: DEVELOPMENT
title: How to develop — commands, conventions, and working rules
status: stable
date: 2026-06-11
tags: [dev, workflow, conventions, rules]
related: [ARCHITECTURE, GOTCHAS]
---

# Development

## Commands (backend — this repo)
Run from `Backend_task_list/`. (Authoritative list: `package.json` `scripts`.)
- `npm run typecheck` — `tsc --noEmit`. **Must be 0 errors before claiming done.**
- `npm run lint` — eslint. **Must be 0 errors.** (`eval/` is excluded from eslint + tsconfig.)
- `npm run build` / `npm run dev` — compile / run with reload.
- `npm run eval` — golden-set AI eval. **Real, paid Vertex calls** (needs creds; not CI). Held-out inputs only — see GOTCHAS #9.
- **Prisma:** `npx prisma migrate dev` (apply/dev migrations), `npx prisma studio` (inspect DB), seed via the seed scripts.
- **Seeds:** `prisma/seed-figital.ts` builds the **figital demo org** (matrix hierarchy: ashok & subha → [daksh, revyant]; the seed is correct — the matrix is intentional). `prisma/seed-hierarchy.ts` is a richer hierarchy fixture (has skip-level edges). Pick the right one for what you're testing.

## Commands (frontend — `Task-List/`, sibling repo)
- `npm run typecheck`, `npm run lint`, `npm run dev`, `npm run build`.
- ⚠️ The frontend is an **active multi-author workspace**. Its typecheck may be red from
  someone else's mid-migration files — when you change a frontend file, confirm **your**
  file isn't in the error list rather than expecting a globally green build.

## Environment
- `.env` (loaded by `config/env.ts`, `override: true` — see GOTCHAS #1). Validated with zod.
- **DB:** `DATABASE_URL` (Postgres; Neon in deploy).
- **Vertex AI:** Google service-account credentials (`secrets/` holds the SA json, gitignored) + project/location. Model is `gemini-2.5-flash`.
- **Auth:** JWT secret.
- Deployed on **Render free tier** (512MB / 0.1 vCPU) — memory and the synchronous meeting call both matter (GOTCHAS #2, #3).

## Code conventions
- **ESM + strict TypeScript.** Import with explicit `.js` extensions (`./foo.js`), even from `.ts`.
- **Layering is enforced by discipline:** `routes → controllers → services → repositories`; **Prisma is called ONLY in repositories**; services are framework-agnostic (no Express types). AI prompts in `lib/prompts/`; Vertex client in `lib/vertex.ts`.
- **Validation:** zod schemas in `schemas/` for both input and AI output (`responseJsonSchema`). Keep prompt output shape and schema in sync (GOTCHAS #10).
- **Errors:** throw the `AppError` hierarchy (`NotFoundError`, `ForbiddenError`, `ConflictError`, `UpstreamError`…); the central error middleware maps them to `{ error: { code, message, details } }`.
- **Dates:** user-timezone-aware "today" via `utils/date.ts`; `@db.Date` columns store local dates. Soft-delete via `deletedAt`.

## AI / prompt conventions (important)
- **General, never overfit.** A rule or example added because of one bug must be stated as a *general principle* with a generic illustration — never hardcode the incident's nouns (no "the developer" / "Tech Admin"). Same for eval cases: **held-out inputs** only.
- **First-person, anti-leak.** User-facing copy and `reasoning` say "we"/the app did it — **never "AI"**, never ids / "attendees list" / rule numbers.
- **Reuse `shared-rules.ts` constants** (date resolution, English output, conservative default, target-date, priority cues, recommendation title, names/honorifics, hospital vocabulary) — don't re-author per surface.
- **Per-surface tuning** lives in `ai-config.ts` (temperature, thinkingBudget, timeout). Use it; don't hardcode in call sites.

## Working rules (how to behave in this project)
- **DON'T auto-commit.** The owner reviews diffs and commits themselves. Make changes, leave them uncommitted, and summarize what changed + which files. Only commit a specific batch when explicitly told. Never sweep up the frontend's parallel WIP.
- **Fixing/improving existing features > adding new ones.** New capability is lowest priority and only if it breaks nothing. Admin/org tooling is lowest of all.
- **Verify before claiming done:** backend `npm run typecheck` + `npm run lint` (0/0). Don't claim a frontend build is green if the red errors are someone else's files — say which are yours.
- **Meetings are demo-critical** — treat summary + recommendation quality as load-bearing.
- For new architectural decisions, add an ADR in `decisions/` (next number); don't edit accepted ADRs.
