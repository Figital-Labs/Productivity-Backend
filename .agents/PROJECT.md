# PROJECT — What We're Building and Why

> This file is part of the `.agents/` series written for future AI sessions (and human teammates) joining this project. Read PROJECT.md → SCOPE.md → DECISIONS.md in that order to get the full context in ~10 minutes.

## What This Product Is

A **daily work tracker with voice and AI**. Picture a smart to-do app built around two daily rituals:

- **Morning** — the user opens the app and creates the day's task list. They can dictate it ("I need to do morning rounds, review patient charts, attend the staff meeting"), type it, or snap a photo of a handwritten task sheet. Often a mix of all three in one session. AI extracts structured tasks from whatever they gave it.

- **Through the day** — they add more tasks as new things come up, edit priorities ("the chart review is now urgent"), and check items off as they finish. Voice, typed input, or simple checkbox — all of these work, any time of day.

- **End of day** — they record a retrospective ("I finished morning rounds, did half the chart review, the staff meeting got pushed"). AI maps that back to today's tasks (complete / partial / not-done) AND generates a structured feedback summary (achievements, missed items, additions, tips).

Plus there's an inbox of AI-generated alerts, a per-user holiday calendar so the app knows when the user isn't working, and a history view to look back at past days.

## What's Built Already (The Frontend)

A separate team owns the frontend. It's a React + Vite app at `d:\gig_project\Task-List\`. It looks complete — you can click through every screen, the AI even works because it calls Google's Gemini API directly from the browser. **But nothing is real yet:**

- The microphone button changes color but doesn't actually record audio.
- "Submit Day Plan" waits 1.5 seconds and shows a popup. Nothing saves.
- Refreshing the page wipes all data.
- The Gemini API key is sitting in the browser code where anyone can steal it.

## What We're Building (The Backend)

The server program that lives behind the frontend. Our job for the POC:

1. **Save things.** Tasks, notes, alerts, holidays, submissions — all persisted in Postgres so they survive a reload.
2. **Handle voice.** Frontend uploads audio, our server sends it to Gemini (via Vertex AI) for transcription + task extraction, returns structured tasks.
3. **Handle images.** Same flow for handwritten task sheet OCR and proof-of-work photos.
4. **Handle the day-closure flow.** Compare planned tasks vs actual work via AI, generate structured feedback.
5. **Keep the AI credential safe.** All Gemini/Vertex calls move to the server. The browser never sees the key.
6. **Pretend there's one user.** No login screen, no auth. The frontend sends `X-User-Id: demo-user-1` in a header and we trust it.

## The User Workflow in Detail (Critical to Understand)

This is how a user actually uses the app over a day. Read it carefully — every backend endpoint exists to support some part of this:

```
08:00 — User opens app, taps mic.
        "Today I need to do morning rounds, review patient charts, 
         and attend the staff meeting at 2pm."
        They also snap a photo of a sticky note with two more items.
        
        Backend: receives audio + image, sends both to Gemini in one 
        multimodal call. Gemini returns extracted tasks. Backend creates 
        them in DB. Returns the list to the frontend.

11:00 — User taps mic again.
        "Add: call Dr. Smith. Also, the chart review is now urgent."

        Backend: gets audio + the current pending tasks (top N) for context.
        Gemini classifies intent per phrase:
          - "Add: call Dr. Smith" → CREATE new task
          - "chart review is urgent" → UPDATE priority of existing task
        Backend executes both via the same repository methods CRUD uses.

13:30 — User finishes morning rounds. Taps the checkbox next to that task.

        Backend: standard PATCH /tasks/:id { completed: true }. 
        No AI involved. Same primitive the AI flow above ultimately calls.

19:00 — User opens Day Closure. Taps mic.
        "I finished morning rounds. Got halfway through the chart review.
         The staff meeting got pushed to tomorrow. I also did emergency 
         triage at 3pm — that wasn't planned."

        Backend: 
          1. Sends audio + today's task list to Gemini for intent classification.
          2. Gets back: complete X, partial Y (with notes), not_done Z, 
             and a RECOMMENDATION for a new task ("emergency triage").
          3. The recommendation is NOT auto-created — it's returned to the 
             frontend as a suggestion. User taps "Add" or "Skip."
          4. Backend also makes a SECOND Gemini call to generate the 
             structured feedback (achievements, missed, partial, tips, summary).
          5. Persists DayClosureSubmission with everything.
```

## The Critical Principle

**AI is sugar on conventional CRUD.** Every AI-driven action ultimately calls the same repository methods that the manual CRUD endpoints use. AI decides *what to do*; boring repository code does it.

This means:
- A user who never uses voice can still use the app fully via type-and-tap.
- The AI never bypasses validation, never writes outside the normal data model.
- If the AI is wrong, the user can correct manually using the same endpoints.
- Tests, observability, and debugging all happen at the CRUD layer — the AI layer is a thin wrapper.

## Future Vision (Not Built, But Designed For)

The product is likely going to graduate into a **hospital staff productivity tool**. In that world:

- **Multi-tenant**: multiple orgs (hospitals), each with their own users.
- **Hierarchy**: managers (e.g., head nurses, department heads) maintain their staff, assign tasks, and review their staff's day closures.
- **Manager review flow**: managers see what their staff planned vs delivered each day.
- **Compliance**: hospital data is sensitive (PHI) and will need real protections.
- **Auth**: real authentication, probably Google OAuth (hospital staff likely have Google accounts).

**None of this is being built for the POC.** But every architectural choice — schema columns, code structure, layering — is designed so that adding these later is *additive*, not a rewrite.

Most importantly: every owned entity has a `userId` foreign key from day 1. Single-user POC means every row has the same value (`demo-user-1`). Multi-user later means more values. Zero schema migration. The auth middleware that today returns a hardcoded user just gets replaced by one that decodes a JWT.

## Who's Doing What

- **Frontend team** (separate, not in this repo) — owns `d:\gig_project\Task-List\`. We don't touch their code. We just provide an API.
- **Backend team** (us) — owns `d:\gig_project\Backend_task_list\`. Provides the API. Owns the database. Owns the AI integration.
- **The client** — a (likely hospital) organization that will see the POC and decide whether to fund the real product.

## How To Use These Docs

- **PROJECT.md** (this file) — the product story. Read first.
- **SCOPE.md** — what's in the POC and what's deferred, with reasoning per item.
- **DECISIONS.md** — every architectural decision with the reasoning behind it. If you're about to write code and aren't sure why something is designed a certain way, check here first.

The plan file at `C:\Users\ashoka\.claude\plans\hey-calude-i-was-jiggly-torvalds.md` has the sprint-by-sprint execution plan.
