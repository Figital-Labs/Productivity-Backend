---
id: CONVENTIONS
title: Code, Commit, and Working Conventions
status: stable
date: 2026-05-22
tags: [meta, style, workflow]
related: [AGENTS-README]
---

# Conventions

These are **the rules of the codebase**. Agents follow them without re-asking. Humans follow them too.

If a convention here turns out to be wrong, propose a change via an ADR (which can supersede this doc's relevant section).

---

## Code Conventions

### Language & Build
- TypeScript with **strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`**. Don't disable these.
- Module system: **NodeNext ESM**. Imports use `.js` extension even for `.ts` files (TypeScript NodeNext convention).
- `verbatimModuleSyntax: true` — use `import type` for type-only imports.

### Project Structure
Refer to [ARCHITECTURE.md](./ARCHITECTURE.md) for the folder layout. Key principles:
- **Routes** only do HTTP framing (parse req, call controller, format response).
- **Controllers** orchestrate — they call services, never touch Prisma.
- **Services** hold business logic — framework-agnostic, no Express types leaking in.
- **Repositories** are the **only** place Prisma is called.
- **Schemas** (zod) are the source of truth — types are inferred from them.

### Naming
- Files: `kebab-case.ts` for source; `PascalCase.tsx` only if there's ever JSX (there isn't).
- Variables, functions: `camelCase`.
- Types, classes: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` only for true compile-time constants; module-scoped config is `camelCase`.
- Booleans: prefix with `is`, `has`, `should`, `can`.

### Exports
- **Named exports only.** No `export default`. (Exception: the existing `prisma.ts` default — leave it for now; ADR-TBD when we change it.)
- Reason: named exports make refactoring and grep both work cleanly; tree-shaking is better.

### Errors
- Throw subclasses of `AppError` (see `src/lib/errors.ts` once it exists).
- Never throw raw strings. Never throw `Error` directly.
- HTTP errors map to status codes via the central error middleware — services don't know HTTP.

### Comments
- Default to no comments.
- Only add a comment when the **why** is non-obvious: a hidden constraint, a workaround for a specific bug, an invariant a reader would miss.
- Never write what the code does (well-named identifiers do that).
- Never write "this is used by X" — that rots.

### Validation
- Every request body, query, params: parse through a zod schema before reaching the controller.
- No `as any`, no `// @ts-ignore`. If TypeScript complains, fix the types.

---

## Commit Conventions

**Important: the agent never runs `git commit`.** Commits are the user's responsibility. The agent writes code; the user reviews, stages, and commits. If you (agent) finish a chunk of work, leave the working tree dirty and the user will commit. Do not stage, do not commit, do not push under any circumstance.

When you propose a commit message (in chat, not via `git commit`), still follow **Conventional Commits**:

```
<type>(<scope>): <short description>

<optional body>

<optional footer>
```

**Types:**
- `feat`: new feature
- `fix`: bug fix
- `refactor`: code change that doesn't add a feature or fix a bug
- `chore`: tooling, config, deps
- `docs`: docs only
- `style`: formatting (no logic change)
- `test`: tests (deferred for POC, but reserved)

**Scopes** map to folders / sprints (e.g., `feat(tasks): ...`, `chore(env): ...`).

**Rules:**
- One commit per logical change. Don't pile multiple features into one commit.
- Reference ADRs and sprint numbers in the body when relevant: `Per ADR-0009, ...`
- Never use `--no-verify`, `--amend` on pushed commits, or `--force` without explicit user approval.

---

## Working Patterns

### Small Sprints, Sync-Heavy
Per the approved plan, work is broken into small sprints. Each sprint ends with a checkpoint where the user reviews. Don't batch sprints.

### Web-Research Before Writing SDK Code
Training data is from January 2026. The ecosystem moves. Before writing code against the Vertex AI SDK, AWS S3 SDK, multer, or any moving-target library, **fetch current docs from the web**. Don't trust memory.

### Use `/simplify` at Sprint Checkpoints
At the end of every sprint that touches code, run `/simplify` on the new code. Fix anything it flags before declaring the sprint complete.

### Don't Expand Scope Autonomously
If the user said "build feature X," build feature X. Don't add adjacent features, tests, logging, or refactors unless they're in the plan or explicitly asked for. Every line of "while I'm here" code is future maintenance.

### Update STATE.md
Update [STATE.md](./STATE.md) when:
- You start a sprint (claim ownership).
- You finish a sprint (mark complete).
- You hit a blocker.
- You make a notable change worth recording in the changelog.

### Use TodoWrite for Multi-Step Work
For sprints with 3+ tasks, use the TodoWrite tool to track progress. Mark tasks complete immediately as you finish them — don't batch.

### Read Before Edit
Always read a file before editing it. The Edit tool requires it, and it prevents you from making changes based on stale assumptions.

### Confirm Before Destructive Actions
Before deleting files, force-pushing, dropping tables, running `rm -rf`, or anything that loses work — **confirm with the user first.** Unless the user has pre-authorized that specific action.

### One Task In Progress at a Time
When using TodoWrite, only **one task** has `status: in_progress` at any moment. Complete it (or move it back to pending if blocked) before starting another.

---

## When You're Tempted to "Just Add It While You're Here"

Check [SCOPE.md](./SCOPE.md). If the thing is in the "Deferred" list, **don't add it.** Even if it would take five minutes. Every deferred item is deferred for a reason that's documented.

Common temptations and where they belong:
- Tests → [ADR-0019](./decisions/0019-deferred-tests.md)
- Structured logging → [ADR-0018](./decisions/0018-deferred-logging.md)
- OpenAPI → [ADR-0020](./decisions/0020-deferred-openapi.md)
- Caching, Redis → [SCOPE.md](./SCOPE.md#out-of-scope-deferred)
- Real auth → [ADR-0008](./decisions/0008-stub-auth.md)
