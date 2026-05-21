# DECISIONS — Architectural Choices and Their Reasoning

> Read [PROJECT.md](./PROJECT.md) and [SCOPE.md](./SCOPE.md) first. This file explains *why* the code looks the way it does. If you're about to write code and aren't sure why something is structured a certain way, check here first.

Each decision below has the same shape: **the choice**, **why we made it**, **what we considered and rejected**, and **what would make us revisit it.**

---

## 1. AI Provider: Vertex AI (Not Public Gemini API)

**Choice:** Use `@google-cloud/vertexai` (Vertex AI on GCP). The user provided a GCP service account JSON for project `nth-rookery-341212`.

**Why:**
- Production-grade IAM auth (service account), not an API key in env.
- Same provider as our blob storage (GCS) — single cloud, single credential model.
- The credential the user provided is for Vertex; switching providers means asking for a different credential.

**Considered and rejected:**
- *Public Gemini API (`ai.google.dev`, API key)* — easier setup (30 seconds), generous free tier, **but** requires an API key string in env that has to be guarded forever. The user has Vertex creds; no reason to introduce a second AI dependency.

**Would revisit if:**
- Vertex API or billing isn't enabled on the user's project and would take real time to enable.
- We need a feature only the public API has (rare).

**Practical notes:**
- The service account JSON lives at `./secrets/vertex-sa.json` (gitignored). `.env` references it via `GOOGLE_APPLICATION_CREDENTIALS=./secrets/vertex-sa.json`.
- Required env vars: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT=nth-rookery-341212`, `GOOGLE_CLOUD_LOCATION=us-central1` (or `asia-south1` depending on what's enabled).
- The Vertex SDK has been moving fast — **always web-research the current API shape before writing code** that uses it.

---

## 2. AI Strategy: Multimodal Gemini in One Call (No Separate STT)

**Choice:** Send audio (and images) directly to Gemini 2.5 Flash via Vertex as multimodal input. Get back both the transcript and the structured output (extracted tasks, action classifications) in one call.

**Why:**
- One API call instead of two (STT + LLM). Half the round-trip latency.
- One SDK, one auth, one billing line.
- Gemini's audio transcription quality is comparable to dedicated STT for single-speaker dictation (which is all we care about for POC).

**Considered and rejected:**
- *Separate Vertex Speech-to-Text → Vertex Gemini* — more code, more failure modes, no quality win for single-speaker dictation.

**Would revisit if:**
- Meetings come back into scope (multi-speaker overlap is where dedicated STT shines).
- Audio quality measurably suffers in Gemini compared to dedicated STT for our actual users.

---

## 3. Voice Endpoint: General-Purpose with Intent Classification

**Choice:** A single `POST /voice/process` endpoint that handles **all** voice-driven actions: creating new tasks, updating priority of existing tasks, marking tasks complete, marking tasks partial.

**Why:**
- Matches how users actually speak. Real example: *"I finished morning rounds, the chart review is now urgent, and I need to call Dr. Smith."* That sentence triggers complete + priority_update + create — three different intents in one breath.
- Gemini infers intent from cue words: *"I finished X"* → complete; *"X is urgent"* / *"ASAP"* → priority bump; *"I need to do X"* / *"add X"* → create.
- One endpoint, one prompt, one round trip. Simpler than a route per intent.

**Response shape:**
```json
{
  "transcript": "...",
  "actions": [
    { "type": "created",          "task": {...} },
    { "type": "priority_updated", "taskId": "...", "newPriority": "..." },
    { "type": "completed",        "taskId": "..." },
    { "type": "partial",          "taskId": "...", "notes": "..." }
  ],
  "recommendations": [
    { "title": "...", "priority": "...", "reasoning": "..." }
  ]
}
```

**Considered and rejected:**
- *Separate endpoints per intent (`/voice/create-task`, `/voice/complete-task`, etc.)* — forces the frontend to pre-classify intent, which it can't reliably do without running Gemini itself. Defeats the point.

**Would revisit if:**
- Gemini's intent classification proves unreliable in practice and we need to constrain inputs more strictly.

---

## 4. Duplicate Handling: Always Create + Flag + Priority Bump (Never Suppress)

**Choice:** When the AI detects that a user's dictation overlaps with an existing pending task, it **still creates the new task** with a `reason` field. Separately, if the user signaled urgency, it **also bumps the priority** of the existing task.

**Why (this is a subtle product decision):**
- User re-mentioning a task isn't necessarily an error. They might genuinely mean it as a second occurrence (e.g., "check on patient X" happens twice a day — morning and evening).
- Silently dropping a duplicate would feel buggy: *"I just said that, why didn't it appear?"*
- Bumping priority when the user signals urgency captures the *intent* of the re-mention without forcing the user into a "modify existing" flow.

**Considered and rejected:**
- *Silently skip duplicates* — clean UX but obscures user intent. Bad if user actually meant a repeat occurrence.
- *Return everything with a `possibleDuplicateOf` metadata field* — added a field nobody reads. YAGNI.
- *Ask the user to confirm duplicates via UI* — requires frontend cooperation we don't have.

**Would revisit if:**
- Users complain that they're getting too many duplicates and want the AI to be more aggressive about merging.
- Frontend team wants to add a "merge tasks" feature.

---

## 5. Ad-Hoc Work Handling: Recommendation Pattern (Never Auto-Create)

**Choice:** When the user mentions doing work that wasn't on the plan (most common in day-closure), the AI returns it in a `recommendations` array. **The backend does not write it to the DB.** The frontend shows it as a suggestion with Add/Skip buttons; if the user taps Add, the frontend POSTs to `/tasks` via the normal create endpoint.

**Why:**
- "AI suggests, user confirms" is the universal pattern for state-mutating AI features. Examples:
  - Apple Reminders + Siri always confirms: *"Got it. I'll add 'buy milk.' Sound good?"*
  - Gmail Smart Reply / Compose suggests text, never auto-sends.
  - GitHub Copilot suggests code, you accept with Tab — never auto-writes.
  - Sunsama (end-of-day reflection app) asks "anything else today?" with an explicit add button.
- Auto-creating tasks the user didn't ask to create is silently inserting state. That's the wrong default for any AI surface.

**Considered and rejected:**
- *Auto-create the new task with `completed: true`* — keeps history accurate but violates the suggest-vs-act principle. User loses control.

**Would revisit if:**
- The recommendation pattern proves annoying in practice and users want auto-accept.

---

## 6. AI is Sugar on Conventional CRUD

**Choice (architectural principle, not a single technology):** Every AI-driven action calls the same repository methods that the manual CRUD endpoints use. The AI layer is a thin wrapper that **decides what to do**; the repository layer **does it**.

**Why:**
- A user who never uses voice can still use every feature via manual CRUD. The app is fully usable without AI.
- The AI never bypasses validation. It can't write outside the data model the manual endpoints would.
- If the AI is wrong, the user can correct manually using the same endpoints.
- Tests, observability, and debugging happen at the CRUD layer. The AI layer is testable in isolation (mock the Vertex call; verify the right repository methods were called with the right args).

**Practical implication:** Services for tasks, notes, etc. have no AI awareness. They expose pure CRUD methods. The voice/image services *call into* the task service, not the other way around.

**Would revisit if:** Never. This is the load-bearing principle of the architecture.

---

## 7. Layered Architecture (Routes → Controllers → Services → Repositories)

**Choice:** Standard 4-layer split. Routes handle HTTP framing. Controllers orchestrate. Services hold framework-agnostic business logic. Repositories are the only layer that touches Prisma.

**Why:**
- Business logic in services means testable without booting an Express app.
- Repository pattern means adding multi-tenant `WHERE orgId = ?` later is one line per entity.
- Standard pattern. Easy for new hires (or future AI sessions) to navigate.

**Considered and rejected:**
- *Flat structure (everything in `index.ts`)* — fine for 30 LOC, painful past 500.
- *NestJS-style decorators + DI container* — overkill for POC scale; reverse-able if needed.

**Would revisit if:**
- Codebase grows past ~5k LOC and we need stronger module boundaries (then look at NestJS or hex architecture).

---

## 8. Auth: Stub Middleware Reads `X-User-Id`, Schema Is Multi-Tenant-Ready

**Choice:** For POC, a middleware reads the `X-User-Id` header and returns a hardcoded user object. Schema has `userId`, `orgId`, `role` columns on every owned entity. A `canAccess(user, resource)` helper wraps every read/write — returns `true` for POC.

**Why:**
- Zero auth library for POC. The frontend sends `X-User-Id: demo-user-1` and we trust it.
- Schema is real. Adding real auth later means swapping the middleware, not migrating tables.
- The `canAccess` helper means business code never directly checks "is this my row" — that one helper has all the logic.

**Considered and rejected:**
- *No userId at all in POC* — would require a destructive migration later.
- *Email + password + JWT now* — ~5–8 hours of work for a feature nobody demos. Adds password-reset complexity (email provider, reset tokens).
- *Google OAuth now* — ~3–5 hours; viable choice when login becomes real. Not for POC.

**Would revisit if:** Multi-user testing begins, OR the client demo specifically needs a login screen.

---

## 9. Storage: GCS from Day 1, Behind a `BlobStorage` Interface

**Choice:** All media (proof-of-work images, videos, audio) uploads to **GCS** from the start. The code only talks to a `BlobStorage` interface; the GCS implementation is the only concrete impl for POC. S3/R2 implementations deferred.

**Why:**
- Client demos must show media live from cloud, not from our laptop. Local-disk storage doesn't survive `git clone` on another machine, which is unacceptable for the demo.
- Aligned with Vertex (same GCP project, same service-account auth — just add `roles/storage.objectAdmin` on the bucket to the existing SA).
- Interface keeps S3 / R2 / future providers swappable without touching business logic.

**Considered and rejected:**
- *Local disk for POC, GCS later* — initially proposed, but the user pointed out the demo problem. Reversed.
- *Base64 in DB* — bloats DB size, ruins WAL, awful for video. Never the right call.

**Would revisit if:** Need a cheaper provider at scale (R2 has no egress fees and is much cheaper than GCS).

**Practical notes:**
- User provides bucket name + adds `roles/storage.objectAdmin` to the SA when ready.
- Sprint 5 (voice + AI) doesn't need GCS (audio is sent inline to Gemini). Sprint 6 (media attachments) is where storage starts being exercised.

---

## 10. Per-User Timezone, Default `Asia/Kolkata`

**Choice:** `User.timezone` column. Default `Asia/Kolkata` (likely target client is in India). All "today" queries compute the user's local date — store an absolute timestamp + a date-only `targetDate` column on Task.

**Why:**
- Day-plan and day-closure are tied to a calendar day. If a hospital staff member is in IST and the server is in UTC, "today's tasks" must mean *their* today.
- Hardcoding one timezone now would box us in once we have users in other regions.
- The cost of storing a string per user is zero.

**Considered and rejected:**
- *Server UTC for everything* — "today" shifts at midnight UTC; weird UX for users at 5:30am IST.
- *No per-user timezone, hardcode IST* — works for one region, painful when expanding.

**Would revisit if:** Never. This is correctness, not optimization.

---

## 11. Submit Semantics: Soft Lock with Immutable Snapshot

**Choice:** `POST /day-plan/submit` records a `submittedAt` timestamp AND stores an immutable JSON snapshot of the task list as it was at the moment of submission. The user can keep editing the live task list afterward — the snapshot stays unchanged.

**Why:**
- Mobile users always need to edit after submit (they remember a task at 9:05am after submitting at 9:00).
- The snapshot is the *commitment* — it's what a future manager would review.
- Live task list keeps reflecting reality, but the snapshot is the audit record.

**Considered and rejected:**
- *Hard lock (no edits after submit)* — punishes the user who forgot something.
- *Just a timestamp, no snapshot* — loses the audit trail. Manager can't see what was promised.

**Would revisit if:** Never. This is correct.

---

## 12. AI Outputs Persisted Write-Once

**Choice:** Every Vertex/Gemini call's output is stored. Transcripts go to `VoiceInteraction`. Extracted actions go there too. EOD feedback goes to `DayClosureSubmission.aiFeedback`. Image extractions go to `ImageExtraction`.

**Why:**
- Reopening a task should show the same AI feedback the user originally saw, not a regenerated one.
- Costs Gemini tokens only once per artifact.
- Required for audit trails (manager review in multi-tenant future).
- Lets us A/B different prompt versions without breaking existing data.

**Considered and rejected:**
- *Regenerate on demand* — cheap disk, expensive Gemini bill, inconsistent UX.

**Would revisit if:** Never. Write-once is correct.

---

## 13. Soft Delete via `deletedAt`

**Choice:** `Task`, `Note`, etc. have a nullable `deletedAt` timestamp. Default queries filter `deletedAt IS NULL`. A `POST /tasks/:id/restore` endpoint clears it.

**Why:**
- The frontend has a "restore" UI (the `restoreTask` function exists in `AppContext.tsx`). Backend needs to support it.
- Soft delete is cheap and almost always pays off.

**Considered and rejected:**
- *Hard delete* — simpler but means undo requires logging changes elsewhere.

**Would revisit if:** Privacy laws require true deletion (GDPR-style). Then we'd add a `purgeDeleted` job.

---

## 14. Prompt Context: Top 20–100 Pending Tasks (Not Full List)

**Choice:** When sending the user's pending tasks to Gemini as context, fetch the top 20–100 (most recent / highest priority), not the full list.

**Why:**
- Bounds prompt size predictably.
- A user with 200 open tasks has a different problem (organization, not extraction). We don't optimize for that.

**Considered and rejected:**
- *Send everything* — unbounded prompt size.
- *Send only today's tasks* — too narrow; misses tasks the user might be referring to from yesterday.

**Would revisit if:** Users routinely have more pending tasks than fit and complain about missed matches.

---

## 15. API Versioning: `/api/v1/...`

**Choice:** Every route is under `/api/v1/`. Costs nothing now; saves pain later when the API needs a breaking change.

**Why:** Cheap insurance.

**Would revisit if:** Never.

---

## 16. Validation: Zod Everywhere

**Choice:** Every request body, query string, and route param is parsed through a `zod` schema before reaching the controller. Schemas double as TypeScript types via `z.infer<...>`.

**Why:**
- TypeScript types don't exist at runtime. `req.body` is `any` until validated.
- Single source of truth — same schema is the type *and* the validator *and* (later) the OpenAPI source.

**Would revisit if:** Never.

---

## 17. Idempotency: `Idempotency-Key` Header on Mutating POSTs

**Choice:** All POST endpoints accept an optional `Idempotency-Key` header. Backend stores `(key, response)` in memory for POC, returns cached response on replay.

**Why:**
- Mobile networks are flaky. Without idempotency, "submit day plan" can become "submit day plan twice" on retry.
- In-memory storage is fine for POC (single process). Swap to Redis when multi-pod.

**Would revisit if:** Goes to Redis when we have a real deploy.

---

## 18. Deferred: Logging (Use `console.*` for POC)

**Choice:** Plain `console.log` / `console.error` for POC. No pino, no structured logging, no request IDs.

**Why:**
- Single user, single developer. Logs aren't a debugging bottleneck yet.
- pino + AsyncLocalStorage + request IDs is real infrastructure work; not worth doing until we have multi-user / production / staging.

**Would revisit if:** First non-laptop deploy, OR when debugging stops being trivial with `console.*`.

---

## 19. Deferred: Tests

**Choice:** No vitest, no supertest, no integration tests for POC. Manual `curl` checks at each sprint's checkpoint.

**Why:**
- POC API surface will change. Tests written now would mostly be deleted.
- The bar for not-breaking-things during POC is "the dev exercising it manually."

**Important:** This is NOT a free pass on code quality. We use `/simplify` at sprint checkpoints to enforce strict types, clean structure, no dead code.

**Would revisit if:** Post-POC, before any production deployment.

---

## 20. Deferred: OpenAPI / Swagger

**Choice:** No `/docs` route. Frontend team reads the route files directly.

**Why:** OpenAPI generation from zod is straightforward (`@asteasolutions/zod-to-openapi`) but adds tooling that doesn't pay off until external SDK consumers exist.

**Would revisit if:** Client wants codegen'd SDKs, OR frontend team requests it.

---

## Working Style Notes (Not Architecture, But Important)

These aren't technical decisions but they shape how this codebase gets built.

### Small sprints with sync points
Each sprint produces a reviewable checkpoint. The user reads and approves before the next sprint starts. Don't batch multiple sprints into one PR.

### Web-research before writing AI / cloud SDK code
The training data cutoff is January 2026 and the Vertex AI / GCS SDKs are moving fast. **Always check the current API shape via web before writing code that uses them.** Don't trust memory.

### Quality gate: `/simplify` at every sprint
At the end of every sprint that touches code, invoke `/simplify` to review the new code for reuse, quality, and efficiency. Fix anything it flags before the checkpoint.

### Don't autonomously expand scope
If the user says "build feature X," build feature X. Don't add tests, OpenAPI, logging, or extra features unless they're in the plan or the user asked for them. Every line of "while I'm here" code is future maintenance.

### Future AI sessions: read this directory first
If you're an AI session picking up this project after a break, read PROJECT.md → SCOPE.md → DECISIONS.md before doing anything. They take ~10 minutes to skim and will save you from re-litigating decisions that have already been made.
