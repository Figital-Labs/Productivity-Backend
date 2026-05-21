---
id: SPRINT-01
title: Alignment Docs
status: complete
sprint: 1
started: 2026-05-22
completed: 2026-05-22
owner: claude-session
tags: [sprint, docs]
related: [AGENTS-README]
---

# Sprint 01 — Alignment Docs

## Goal

Capture the entire planning conversation as durable, agent-native documentation in `.agents/` so future sessions (and humans) can pick up the project with full context.

## Tasks

- [x] Create the agent-native directory structure under `.agents/`
- [x] Write `README.md` (the map + agent collaboration rules)
- [x] Write `CONVENTIONS.md` (code, commit, working style)
- [x] Write `GLOSSARY.md` (stable terms)
- [x] Write `PRODUCT.md` (product overview + user journey + future vision)
- [x] Write `SCOPE.md` (in/out of POC with reasoning)
- [x] Write `ARCHITECTURE.md` (data model + API surface + folder structure + AI flows)
- [x] Write `STATE.md` (coordination point — active sprint, locks, blockers, changelog)
- [x] Write `decisions/README.md` (ADR index)
- [x] Write all 20 ADR files (`decisions/0001-...md` through `decisions/0020-...md`)
- [x] Write `sprints/README.md` (sprint plan overview)
- [x] Write this sprint detail file
- [x] Write `sprints/02-repo-setup.md` (next sprint's detail)
- [x] Delete legacy monolithic docs (`PROJECT.md`, `SCOPE.md`, `DECISIONS.md` at root of `.agents/`)

## Owner Pattern

Agent solo. User reviews at checkpoint.

## Acceptance Criteria

- `.agents/` contains the full structure described in [`.agents/README.md`](../README.md).
- Every architectural decision from the planning conversation has its own ADR with stable ID.
- A fresh agent session can read `README.md → STATE.md` and know what's active.
- A fresh human reader can read PRODUCT → SCOPE → DECISIONS in 10 minutes and have full context.
- No content from the planning conversation is lost in the restructure.

## Checkpoint Verification

User reads:
1. `.agents/README.md` — confirms the structure makes sense.
2. `.agents/STATE.md` — confirms current state is accurate.
3. `.agents/PRODUCT.md` — confirms product description matches their understanding.
4. `.agents/SCOPE.md` — confirms in/out boundaries match what we agreed.
5. Spot-check 2–3 ADRs — confirms decisions are captured correctly.

If anything's wrong, user gives feedback, agent fixes, no Sprint 2 until docs are right.

## Result

Sprint completed in one session. Initial pass was a monolithic 3-file structure; user requested agent-native restructure; redone. Final structure has ~30 files but each is small and focused.
