---
id: AGENTS-README
title: Agent Documentation Map
status: stable
date: 2026-05-22
tags: [meta, entry-point]
---

# `.agents/` — Documentation for Agents (and Humans)

**Agents starting a session: read this file first. Then read [STATE.md](./STATE.md) to see what's active.** Everything else is loaded on-demand based on what you're working on.

This directory is the persistent memory of the backend project. It is designed for **multiple agents collaborating** on this codebase — sequentially or in parallel — without losing context or stepping on each other.

---

## How To Use These Docs (Decision Tree)

```
Starting a new session?           → README.md (you are here) → STATE.md
Need product context?              → PRODUCT.md
Need to know what's in/out?        → SCOPE.md
Designing code, need to know why?  → decisions/ (find the relevant ADR)
Writing code, need conventions?    → CONVENTIONS.md
Confused by a term?                → GLOSSARY.md
Need the schema or endpoints?      → ARCHITECTURE.md
Working on a sprint?               → sprints/NN-name.md
Adding a new decision?             → decisions/00NN-slug.md (next sequence number)
```

---

## File Layout & Ownership

| File / Folder | What it holds | When to read | When to update |
|---|---|---|---|
| `README.md` | This map. How to use the docs. | First, every session. | Rarely (only if doc structure changes). |
| `STATE.md` | Live state: current sprint, blockers, recent changes. | After README, every session. | After every sprint, every blocker, every milestone. |
| `PRODUCT.md` | What we're building, user journey, future vision. | When you need product context. | When the product vision changes (rare). |
| `SCOPE.md` | What's in/out of POC. "When to revisit" criteria for deferrals. | When deciding if something belongs in this PR. | When scope changes (also rare). |
| `ARCHITECTURE.md` | Data model, API surface, folder structure, AI flows. | When implementing a feature. | When schema/endpoints/structure change. |
| `CONVENTIONS.md` | Code style, commit style, working patterns. | Before writing any code. | When we adopt a new pattern. |
| `GLOSSARY.md` | Stable terms. Prevents drift. | When you see an unfamiliar term. | When a new term enters our vocabulary. |
| `decisions/` | ADRs — one file per architectural decision. Stable IDs (`ADR-NNNN`). | When wondering *why* something is designed a certain way. | New decision → new file (next sequence number). Decision changes → new ADR that supersedes the old one. **Never edit an accepted ADR.** |
| `sprints/` | One file per sprint. Goals, tasks, acceptance criteria. | When starting / working a sprint. | Update status as you progress. Mark complete at sprint end. |

---

## Frontmatter Convention

Every file in `.agents/` has YAML frontmatter at the top. Agents should be able to scan metadata without reading bodies.

```yaml
---
id: ADR-0009                          # Stable, never changes
title: Use GCS for Blob Storage       # Human-readable, can change
status: accepted                      # proposed | accepted | superseded | deprecated
date: 2026-05-22                      # ISO date, set on creation
tags: [storage, gcp]                  # For filtering
supersedes: null                      # ADR ID if this replaces an older decision
related: [ADR-0001, ADR-0009]         # Cross-references
---
```

**Status values:**
- `proposed` — under discussion, not yet decided
- `accepted` — current authority
- `superseded` — replaced by a newer ADR (which is referenced in `supersedes`)
- `deprecated` — no longer applicable, but not replaced
- `stable` — for non-ADR docs that don't change often

---

## Agent Collaboration Rules

These docs support **multiple agents working at once** (e.g., one on Sprint 4 backend code, another writing migration scripts, another updating docs). To avoid conflicts:

### 1. Atomic files
Each file has **one concern**. Don't merge concerns. If something belongs in its own file, give it its own file.

### 2. Stable references, mutable content
- **Stable**: file paths, ADR IDs, sprint numbers. Don't change them. Don't rename ADRs.
- **Mutable**: content within a file (except accepted ADRs — see below).

### 3. ADRs are append-only
Once an ADR is `status: accepted`, **do not edit it**. If the decision changes:
1. Create a new ADR with the next sequence number.
2. Set its `supersedes` field to the old ADR's ID.
3. Update the old ADR's `status` to `superseded` (this is the only allowed edit to an accepted ADR).

### 4. Sprint files are owned by one agent at a time
The `STATE.md` file declares **who's working on what**. If you're starting work on a sprint, update STATE.md first with your session/agent identifier and timestamp. If another agent is already on it, coordinate or pick a different sprint.

### 5. STATE.md is the coordination point
- Active sprint and who owns it
- Blockers (with timestamps)
- Recent significant changes (append-only changelog at the bottom)

Read STATE.md at the start of every session. Update it when work status changes.

### 6. When in doubt, write a new ADR
Better to capture a decision than to leave it implicit. New decisions get new ADR files.

### 7. Parallel-safe operations
- ✅ Two agents creating different new files in parallel (e.g., a new ADR + a new sprint file)
- ✅ Two agents reading any files in parallel
- ❌ Two agents editing the same file (use STATE.md to coordinate ownership)
- ❌ Two agents creating new ADRs in parallel (sequence number race — claim the next number in STATE.md first)

---

## Where The Plan File Lives

The implementation plan with the full sprint breakdown is at:
`C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md`

That file is the approved plan (signed off by the user). These `.agents/` docs are the *living* version — STATE.md tracks what's actually been built vs what's still planned.

---

## When You're New (Agent or Human)

Take 10 minutes. Read in this order:
1. **README.md** (this file) — 2 min
2. **STATE.md** — 1 min, tells you what's active
3. **PRODUCT.md** — 3 min, gives you product context
4. **SCOPE.md** — 2 min, sets the boundaries
5. **GLOSSARY.md** — 1 min, just skim for terms you'll see

That's enough to start working productively. Load decisions/ADRs and ARCHITECTURE.md on demand when you need them.
