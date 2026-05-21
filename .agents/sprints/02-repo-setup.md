---
id: SPRINT-02
title: Repo Setup & Dev Tooling
status: not-started
sprint: 2
started: null
completed: null
owner: null
tags: [sprint, setup, collaborative]
related: [ADR-0001, ADR-0009]
---

# Sprint 02 — Repo Setup & Dev Tooling

## Goal

Get the existing backend skeleton into a clean, ready-to-build state. Verify the AI credentials work. Add minimum tooling. No business logic yet.

## Owner Pattern

**Together with the user.** This sprint is collaborative because environment differences matter (Windows, the user's `.env` setup, Prisma docker config). Each task below has a sync point — agent proposes, user approves, then we move.

**Agent does not start this sprint autonomously.** Wait for the user to say "let's start Sprint 2" or equivalent.

## Tasks

### 2.1 — Cleanups in existing files
- [ ] Drop `"jsx": "react-jsx"` from [tsconfig.json](../../tsconfig.json) (we're a backend, no React).
- [ ] Turn on the strict flags currently commented out: `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- [ ] Delete the empty [src/app.ts](../../src/app.ts) (we'll recreate properly in Sprint 3).
- [ ] Confirm `npm run dev` (`tsx watch src/index.ts`) starts the existing server.

**Sync point:** confirm with user that these cleanups are OK. Some commented flags might cause widespread errors — fix or back out as needed.

### 2.2 — `.env` reformat and secrets handling
- [ ] Create `secrets/` directory.
- [ ] Move the Vertex service account JSON out of `.env` into `secrets/vertex-sa.json`.
- [ ] Add `secrets/` to [.gitignore](../../.gitignore).
- [ ] `.env` becomes plain `KEY=value` format:
  ```
  DATABASE_URL=postgres://...        # user fills in
  GOOGLE_APPLICATION_CREDENTIALS=./secrets/vertex-sa.json
  GOOGLE_CLOUD_PROJECT=nth-rookery-341212
  GOOGLE_CLOUD_LOCATION=us-central1   # confirm region with user
  PORT=3000
  NODE_ENV=development
  DEMO_USER_ID=demo-user-1
  ```

**Sync point:** confirm `GOOGLE_CLOUD_LOCATION` — `us-central1` vs `asia-south1` depending on what's enabled on the user's GCP project.

**Heads up:** the existing private key in `.env` is now exposed on disk in cleartext. **Recommend user rotates the SA key** (delete the old `task-list@...` SA in IAM, create fresh) after this sprint is done, since the old key may have been screen-shared or sitting in editor caches.

### 2.3 — Verify Vertex connectivity (hello-world)
- [ ] **Web-research current `@google-cloud/vertexai` SDK** — verify the API for listing models / calling `generateContent` before writing any code. SDK is moving fast.
- [ ] Install only `@google-cloud/vertexai` for this sprint (no other AI deps yet).
- [ ] Write a `scripts/vertex-hello.ts` throwaway script that:
  - Loads creds from `GOOGLE_APPLICATION_CREDENTIALS`.
  - Calls Gemini 2.5 Flash with a trivial text prompt (e.g., "Say 'hello'").
  - Prints the response.
- [ ] Run it. If it fails:
  - "Vertex AI API not enabled" → user enables in GCP console.
  - "Billing not active" → user activates billing.
  - "Permission denied" → user grants `roles/aiplatform.user` to the SA.
- [ ] Keep iterating with the user until the script returns "hello" successfully.

**Sync point:** This is the gate. We don't move past this until Vertex actually works.

### 2.4 — Add core dev tooling
- [ ] Install ESLint + `@typescript-eslint/strict-type-checked` + `eslint-plugin-import`.
- [ ] Install Prettier with minimal config.
- [ ] Add `npm run lint`, `npm run format` scripts.
- [ ] First run `npm run lint` — fix any pre-existing issues.

Hold off on: `zod`, `pino`, `multer`, `vitest` etc. — install lazily in the sprints that actually need them.

**Sync point:** confirm with user before installing.

### 2.5 — Database connectivity
- [ ] User starts Prisma Postgres in Docker (their part of the setup).
- [ ] User puts the URL in `DATABASE_URL` in `.env`.
- [ ] Verify `npx prisma db pull` or similar works against it.

**Sync point:** user provides DATABASE_URL.

### 2.6 — First commit
- [ ] `git add` all the cleanup + env reorganization (NOT `secrets/`, NOT `.env`).
- [ ] Commit message: `chore: clean up tooling, move SA creds to secrets/, verify Vertex hello-world`
- [ ] **Do not push** unless user explicitly asks.

## Acceptance Criteria

- `npm run dev` boots a clean Express server.
- `tsconfig.json` has stricter flags on, no JSX.
- `secrets/vertex-sa.json` exists (gitignored), `.env` is plain `KEY=value`.
- `scripts/vertex-hello.ts` successfully calls Gemini 2.5 Flash and prints a response.
- ESLint and Prettier are configured and pass.
- One commit captures the sprint's changes.

## Checkpoint Verification

User reviews:
1. The cleanups didn't break anything (`npm run dev` works).
2. The Vertex hello-world script actually returned a Gemini response — not a stub.
3. `secrets/` is gitignored (run `git status` to confirm).
4. ESLint passes.

If checkpoint passes, Sprint 2 closes. Sprint 3 detail file gets created.

## Blockers Tracked Here

Update [STATE.md](../STATE.md) if anything stalls. Known potential blockers:
- Vertex AI API not enabled on the project (user action required).
- Billing not active (user action required).
- IAM role missing on the SA (user action required).
