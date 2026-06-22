---
id: PRODUCT
title: Product Overview — what KIMS is, who uses it, the core loop
status: stable
date: 2026-06-11
tags: [product, overview]
related: [ARCHITECTURE, GOTCHAS]
---

# Product

> Refreshed 2026-06-11. The earlier version framed this as a single-user to-do POC with
> multi-tenancy/hierarchy/meetings as "future vision." **That future is now the present** —
> all of it is built. This doc describes the product as it actually is.

## What KIMS is
A **multi-tenant team-operations app for hospitals** (white-collar / administrative staff,
not clinical charting). Hospitals run on messy WhatsApp threads, sticky notes, and verbal
handoffs. KIMS replaces that with a structured daily loop where the **AI does the typing**:
staff capture work by voice / photo / text in their own words (Hinglish included) and the
system turns it into structured, trackable tasks.

## The wedge: staff adoption
The single most important thing. **No staff usage → no data → no product.** Everything
downstream (manager dashboards, plan-vs-delivery, meeting insights) is worthless if staff
don't capture their work. So the staff capture experience — fast, forgiving, layman-simple,
works in spoken Hinglish — is the product's center of gravity. **Layman UX is the biggest
pain point and the priority.**

## The two-sided daily loop
**Staff (the wedge):** plan → do → close.
- *Morning:* dictate / photograph / type the day's tasks → AI extracts structured tasks. Submit a **day plan** (snapshot of the commitment).
- *Through the day:* add/complete/repriotitize by voice, text, image, or tap.
- *Evening:* record a retrospective → AI maps it to today's tasks (done/partial/missed) + writes warm feedback. Submit a **day closure**.

**Managers:** delegate, review, meet, oversee.
- **Delegate** down a **matrix hierarchy** (a person can report to more than one manager) by voice/text/image or manually.
- **Review** what each report planned vs delivered.
- **Meetings** (demo-critical — see below).
- **Dashboards:** plan/closure consistency, trends, performers, org/department/group rollups.

## Meetings (demo-critical)
A manager records a meeting (audio + optional notes/images). The system returns a
**professional summary** (Fireflies/Otter-grade: TL;DR + Overview / Key Points / Decisions /
Concerns / Action Items / Open Questions) and **task recommendations** the manager confirms,
edits, or skips — each can be assigned to an attendee. ALL meeting-derived tasks flow through
recommendations (manager confirms before any task is created). Attribution is by **spoken
names** (the model can't reliably tell voices apart — see GOTCHAS). This is the most
scrutinized demo surface; treat its summary + recommendation quality as load-bearing.

## Hierarchy & levels
Org → departments → context groups (ward/OT/shift/project/personal, with **time-bounded**
membership for shift coverage). Users have a numeric **`level`** (100/200/300…) — this is
**internal bookkeeping for authorization gates only; never expose it in the UI.** A manager
can delegate to / see anyone in their report subtree below their level.

## Two principles that govern every change
1. **AI is sugar on conventional CRUD.** Every AI action ultimately calls the same
   repository methods manual CRUD uses. AI decides *what* to do; boring code does it. So the
   app is fully usable by type-and-tap; the AI never bypasses validation or the data model;
   if the AI is wrong the user fixes it manually. (ADR-0006.)
2. **Transparency = first person, never "AI".** User-facing copy and reasoning say "we" /
   the app / the company did it ("we created these 3 tasks"). **Never surface "AI" as the
   actor**, never leak internals (ids, "attendees list", rule numbers). This is a deliberate
   trust/positioning choice, not an oversight.

## Stage & priorities
POC/MVP, deployed on **Render free tier** (512MB / 0.1 vCPU — memory and the synchronous
meeting request both matter; see GOTCHAS). Founder priority order: **fixing/improving
existing features > adding new ones**; new capability only if it breaks nothing. Admin/org
management is lowest priority.

## Repos & ownership
- **Backend** (this repo) — API, DB, AI integration.
- **Frontend** `Task-List/` — React/Vite; **active multi-author workspace**, edited in parallel; don't assume transient breakage is intended, and don't sweep unrelated changes into your work.
