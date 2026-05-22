# Backend Guide

> A single-document reference for the frontend team and product owner. Describes what the backend does, the supported user journeys, every endpoint with example requests, and the parts that are deliberately not built yet.

**Backend version:** POC (Sprints 1-7 complete + text/fusion addendum + Sprint 8 lite JWT auth)
**Last updated:** 2026-05-22

---

## 1. What this backend is for

This is the server side of a daily work-tracking POC, targeted initially at hospital staff (e.g., doctors, nurses, admins) in an Indian context. The product loop is:

> Morning: user opens the app, talks or types or photographs their task list → AI structures it into tasks → user "submits the plan."
> Day: user manages tasks as work happens.
> Evening: user records what got done (voice + commentary) → AI compares the plan vs reality and writes structured feedback in Hinglish.

The backend handles **all persistence, all AI orchestration, and all task lifecycle logic**. The frontend talks to it over JSON HTTP. No state lives in the browser that isn't backed by the API.

**Critical design principle:** AI is sugar on conventional CRUD. Every AI-driven action (voice/image extraction, closure feedback) eventually calls the same repository methods that the manual `POST /tasks` endpoint uses. If AI breaks, manual task management keeps working unaffected.

---

## 2. The product loop at a glance

```
┌─────────────────────────────────────────────────────────────┐
│                          MORNING                            │
│                                                             │
│  User adds tasks via ANY of:                                │
│    • Manual:    POST /tasks                                 │
│    • Voice:     POST /voice/process    (speak the plan)     │
│    • Image:     POST /images/process   (photo of task sheet)│
│    • Text:      POST /text/process     (typed paragraph)    │
│    • All three: POST /process          (fusion: audio +     │
│                                         image + text in     │
│                                         one Vertex call)    │
│                                                             │
│  Then commits:                                              │
│    POST /day-plan/submit  ──▶  immutable snapshot saved     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       DURING THE DAY                        │
│                                                             │
│  Edit/complete/delete tasks freely:                         │
│    • PATCH /tasks/:id    (mark complete, partial, etc.)     │
│    • POST /voice/process (mid-day voice updates)            │
│    • POST /images/process                                   │
│                                                             │
│  Manage standalone notes:                                   │
│    • POST/PATCH/DELETE /notes                               │
│                                                             │
│  Mark holidays as needed:                                   │
│    • POST /holidays/toggle                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         EVENING                             │
│                                                             │
│  POST /day-closure/submit                                   │
│    • Send voice commentary about today                      │
│    • Backend executes voice updates (completed/partial)     │
│    • SECOND AI call generates structured feedback:          │
│        achievements / missed / partial / additions /        │
│        tips / summary                                       │
│    • All in Hinglish                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Authentication & conventions

### Auth

Auth uses email/password login and JWT bearer tokens.

Public endpoints:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`

All other `/api/v1` endpoints require:

```text
Authorization: Bearer <token>
```

Seeded demo login:

```json
{ "email": "demo@kims.local", "password": "demopass123" }
```

Both signup and login return `{ token, user }`. Frontend should store the token and call `GET /api/v1/auth/me` on app launch to verify the cached token and load the current user profile.

### Base URL

All endpoints are under `/api/v1`. Health endpoints (`/livez`, `/readyz`) are unversioned.

```
http://localhost:3000/api/v1/...
```

### Content types

- **Most endpoints:** `application/json`
- **Multipart (file uploads):** `multipart/form-data`
  - `/voice/process` → field name `audio`
  - `/images/process` → field name `image`
  - `/day-closure/submit` → field name `audio`
  - `/process` → optional fields `audio`, `image`, and/or body field `text` (at least one required)

### Standard error shape

All errors come back in this shape:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with id cmpg... not found",
    "details": {
      /* optional */
    }
  }
}
```

### Status code conventions

| Code                        | Meaning                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `200 OK`                    | GET / PATCH success                                                   |
| `201 Created`               | POST success (resource created)                                       |
| `400 Bad Request`           | Validation error, malformed body, wrong file type                     |
| `401 Unauthorized`          | Missing/invalid bearer token or bad login credentials                 |
| `404 Not Found`             | Resource doesn't exist or is soft-deleted                             |
| `409 Conflict`              | Duplicate submission (e.g., day plan twice), already-deleted/restored |
| `413 Payload Too Large`     | File over the upload size limit                                       |
| `500 Internal Server Error` | Unexpected backend error                                              |
| `502 Bad Gateway`           | AI (Vertex) returned malformed output                                 |
| `503 Service Unavailable`   | Health check failed (DB unreachable)                                  |

---

## 4. Use cases (user journeys)

### 4.1 Morning: create tasks by speaking

> Frontend records audio of the user describing their day. POST it to `/voice/process`. Backend transcribes, classifies what to do per phrase, and either creates tasks or surfaces low-confidence items as recommendations for the user to confirm.

```bash
curl -X POST http://localhost:3000/api/v1/voice/process \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@morning-plan.webm;type=audio/webm"
```

**Response:**

```json
{
  "voiceInteractionId": "cmpg...",
  "transcript": "Add patient rounds at 8am, that's urgent. Also, call lab for reports.",
  "actions": [
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Patient rounds at 8am",
      "priority": "high",
      "reasoning": "User said 'urgent' which indicates high priority."
    },
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Call lab for reports",
      "reasoning": "New task identified."
    }
  ],
  "recommendations": []
}
```

**Key behaviors to know:**

- Audio is **streamed to AI**, not stored anywhere (storage deferred to a future sprint).
- Both English, Hindi, and Hinglish input are supported.
- Output text (titles, transcript, reasoning) is always in **Hinglish/English Roman script** — never Devanagari, even if input was.
- If AI is unsure about a phrase, it goes into `recommendations` — frontend must show Add/Skip UI for those; backend writes nothing until user confirms via `POST /tasks`.

### 4.2 Morning: scan a handwritten task sheet

```bash
curl -X POST http://localhost:3000/api/v1/images/process \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@task-sheet.jpg;type=image/jpeg"
```

**Response shape:**

```json
{
  "imageExtractionId": "cmpg...",
  "extractedText": "Today's Tasks\n1. Buy bread\n2. URGENT: Pay bills\n...",
  "actions": [
    { "type": "created", "taskId": "...", "title": "Buy bread", "reasoning": "..." },
    {
      "type": "created",
      "taskId": "...",
      "title": "Pay bills",
      "priority": "high",
      "reasoning": "URGENT keyword detected."
    }
  ],
  "recommendations": []
}
```

**Visual cues the AI understands:**

- `URGENT`, `ASAP`, `!!!`, underlines, stars → priority `high`
- Strikethroughs, checkmarks (✓), `DONE` next to an item → marks the matching existing task as `completed`
- Items that don't match any pending task → `recommendations`

### 4.3 Morning: submit the day plan

After tasks have been created (manually or via voice/image), commit the plan:

```bash
curl -X POST http://localhost:3000/api/v1/day-plan/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "cmpg...",
  "userId": "demo-user-1",
  "date": "2026-05-22T00:00:00.000Z",
  "submittedAt": "2026-05-22T03:11:45.000Z",
  "taskSnapshot": [
    { "id": "...", "title": "Patient rounds at 8am", "priority": "high", "completed": false, ... },
    ...
  ]
}
```

**Important:** Only **one day-plan per (user, date)**. Second submit returns `409 DAY_PLAN_ALREADY_SUBMITTED`. The snapshot is immutable — even if the user edits tasks later, the snapshot stays as it was at submit time. This is what the evening closure compares against.

### 4.4 During the day: manual task management

Standard CRUD. The simplest endpoints - frontend uses these for the regular task list UI. Examples assume `TOKEN` contains a valid login token.

```bash
# List today's tasks
curl http://localhost:3000/api/v1/tasks -H "Authorization: Bearer $TOKEN"

# Create
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Doctor follow-up","priority":"medium","notes":"Call after 4pm"}'

# Mark complete
curl -X PATCH http://localhost:3000/api/v1/tasks/cmpg... \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"completed":true}'

# Soft delete (recoverable)
curl -X DELETE http://localhost:3000/api/v1/tasks/cmpg... -H "Authorization: Bearer $TOKEN"

# Restore a soft-deleted task
curl -X POST http://localhost:3000/api/v1/tasks/cmpg.../restore -H "Authorization: Bearer $TOKEN"
```

### 4.5 Evening: close the day

```bash
curl -X POST http://localhost:3000/api/v1/day-closure/submit \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@closure.wav;type=audio/wav" \
  -F "commentary=Busy day overall"
```

**Response (truncated):**

```json
{
  "dayClosureId": "cmpg...",
  "transcript": "I finished patient rounds. The lab call is partial — they were busy. Also did an emergency triage at 3pm.",
  "taskUpdates": [
    { "type": "completed", "taskId": "...", "reasoning": "User said 'I finished patient rounds'." },
    { "type": "partial", "taskId": "...", "reasoning": "User said 'partial — they were busy'." }
  ],
  "recommendedNewTasks": [
    {
      "title": "Emergency triage at 3pm",
      "completed": true,
      "reasoning": "Mentioned doing ad-hoc work not on the plan."
    }
  ],
  "aiFeedback": {
    "achievements": ["Patient rounds at 8am"],
    "missed": [],
    "partial": ["Call lab for reports"],
    "additions": ["Emergency triage at 3pm"],
    "tips": ["Tomorrow ke liye lab call ko first half mein schedule karo."],
    "summary": "Busy din tha. Rounds done, lab partial raha. Emergency triage achhe se manage ki."
  }
}
```

**Important:**

- Day-closure **requires a prior day-plan for the same date**. Without it: `409 NO_DAY_PLAN_FOR_DATE`.
- One closure per (user, date). Duplicate: `409 DAY_CLOSURE_ALREADY_SUBMITTED`.
- Audio is required; typed `commentary` is optional.
- The AI feedback is structured into 6 fields. **All output is in Hinglish.**
- Closure makes **two AI calls** internally (one for task updates, one for feedback), so expect ~10–20s response time.

### 4.6 Notes (standalone sticky notes)

Notes are separate from tasks — they're free-form text the user wants to remember. They have no date, no priority, no completion state.

```bash
# Create
curl -X POST http://localhost:3000/api/v1/notes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Remember to renew medical license by July"}'

# List active notes
curl http://localhost:3000/api/v1/notes -H "Authorization: Bearer $TOKEN"

# Archive (hides from main view, still recoverable)
curl -X POST http://localhost:3000/api/v1/notes/cmpg.../archive -H "Authorization: Bearer $TOKEN"

# Soft delete
curl -X DELETE http://localhost:3000/api/v1/notes/cmpg... -H "Authorization: Bearer $TOKEN"
```

### 4.7 Holidays (per-user calendar)

User marks dates they're off (leave, sick, religious observances). The day-closure AI knows not to penalize missed tasks on a holiday (future enhancement).

```bash
# Toggle: adds if absent, removes if present
curl -X POST http://localhost:3000/api/v1/holidays/toggle \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-06-12","reason":"Personal leave"}'

# List holidays in range
curl "http://localhost:3000/api/v1/holidays?from=2026-06-01&to=2026-06-30" \
  -H "Authorization: Bearer $TOKEN"
```

### 4.8 Morning: extract tasks from a typed paragraph

> User types a free-form paragraph describing their day — mixing priorities, Hinglish, and run-on phrasing — and POSTs it as JSON. Backend classifies each phrase, creates tasks, and returns the same action/recommendation shape as the voice flow. No audio needed; the text itself is the primary input.

```bash
curl -X POST http://localhost:3000/api/v1/text/process \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"buy milk urgent, call doctor at 4pm, finish quarterly report draft, and aaj report compile karni hai"}'
```

**Response:**

```json
{
  "textInteractionId": "cmpg...",
  "actions": [
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Buy milk",
      "priority": "high",
      "reasoning": "User wrote 'urgent' which indicates high priority."
    },
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Call doctor at 4pm",
      "reasoning": "New task identified from user's text."
    },
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Finish quarterly report draft",
      "reasoning": "New task identified."
    },
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Compile report",
      "reasoning": "Hinglish phrase 'aaj report compile karni hai' resolved to this task."
    }
  ],
  "recommendations": []
}
```

**Key behaviors:**

- JSON body `{ "text": string }`. No file upload. Min 1 char, max 5000 chars.
- Hinglish phrases are handled natively — "aaj report compile karni hai" becomes a proper task title.
- The word "urgent" (and equivalents like "ASAP", "jaldi") maps to `priority: "high"`.
- There is **no `transcript` field** in the response — unlike voice, the input text IS the content; it is not re-transcribed.
- When the AI is unsure about a phrase (too vague, or refers to a task not in the pending context), it goes into `recommendations`. Backend writes nothing for those.
- Smoke tested 2026-05-22: 4-item Hinglish paragraph → 4 `created` tasks in ~13s, including correct Hinglish resolution and "urgent" → `priority: "high"`.

### 4.9 Morning: composite input (audio + image + text in one call)

> The morning composer flow often involves all three: user dictates into the mic, attaches a photo of their handwritten task sheet, and types a couple of extra notes. POST `/process` bundles all three into a **single Vertex call** — the model sees everything together and can cross-reference across modalities. Each returned action and recommendation carries a `source` field indicating which modality contributed it.

```bash
curl -X POST http://localhost:3000/api/v1/process \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@subah-ki-planning.wav;type=audio/wav" \
  -F "image=@kaam-ki-list.png;type=image/png" \
  -F "text=Aur haan, evening mein doctor ko call karna hai"
```

**Response:**

```json
{
  "unifiedInteractionId": "cmpg...",
  "actions": [
    {
      "type": "created",
      "taskId": "cmpg...",
      "title": "Buy bread",
      "source": "voice",
      "reasoning": "User said 'buy bread' in the audio clip."
    },
    {
      "type": "completed",
      "taskId": "cmpg...",
      "source": "image",
      "reasoning": "Item crossed out in the photo matches pending task 'Pay electricity bill'."
    }
  ],
  "recommendations": [
    {
      "title": "Milk lana",
      "source": "image",
      "reasoning": "Item visible in photo did not match any pending task — surfaced for user to confirm."
    },
    {
      "title": "Doctor ko call karna (evening)",
      "source": "text",
      "reasoning": "Typed note added as ad-hoc; no matching pending task found."
    }
  ]
}
```

**Key behaviors:**

- Multipart body: optional `audio` file, optional `image` file, optional `text` body field. **At least one must be present** — empty request returns `400 VALIDATION_ERROR`.
- All three modalities are processed in a **single Vertex `generateContent` call** — wall-clock time is one AI round-trip (~10–15s), not three sequential calls.
- Each action and recommendation carries a `source: "voice" | "image" | "text"` tag indicating which modality drove it.
- **Cross-modal grounding:** the model can relate what was said to what was written in the image. E.g., "complete the third item on my list" in audio, combined with a photo of that list, resolves correctly.
- **Contradiction handling:** if audio and image appear to conflict about the same task, the model defaults to `recommendations` rather than auto-executing the action (conservative-default rule from ADR-0005 still applies).
- **No `transcript` or `extractedText` fields in the response.** This is intentional — dropping them avoids the OCR-then-classify cascade where one step's hallucination compounds into the other. Per-action `reasoning` captures the modality cue inline, which is more useful to the frontend than a raw OCR dump.
- The `source` tag on each action is the audit trail that was dropped from the top-level response.
- Smoke tested 2026-05-22: audio + image + text → 201 in ~11s, 2 confirmed actions (one `source:"voice"`, one `source:"image"`), 2 recommendations (one `source:"image"` for unmatched image item, one `source:"text"` for ad-hoc note). DB verified: `UnifiedInteraction.actions` JSON carries per-action `source` tags. Subset tests (text+audio, text only, empty request) also passed.

---

## 5. API reference

### Health

| Method | Path      | Purpose                                              |
| ------ | --------- | ---------------------------------------------------- |
| GET    | `/livez`  | Liveness probe (always 200 if process is running)    |
| GET    | `/readyz` | Readiness probe — 200 if DB reachable, 503 otherwise |

### Auth

| Method | Path                  | Purpose                                                      |
| ------ | --------------------- | ------------------------------------------------------------ |
| POST   | `/api/v1/auth/signup` | Create a user with `{email, name, password}`. Returns token. |
| POST   | `/api/v1/auth/login`  | Login with `{email, password}`. Returns token.               |
| GET    | `/api/v1/auth/me`     | Verify bearer token and return the current user profile.     |

### Tasks

| Method | Path                            | Purpose                                                                                                            |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/tasks?date=YYYY-MM-DD` | List tasks for a date (default: today in user's TZ). Sorted by priority then creation time. Excludes soft-deleted. |
| POST   | `/api/v1/tasks`                 | Create a task manually. Body: `{title, targetDate?, notes?, priority?}`                                            |
| PATCH  | `/api/v1/tasks/:id`             | Update fields. Body: any subset of `{title, notes, completed, isPartial, priority}`                                |
| DELETE | `/api/v1/tasks/:id`             | Soft delete (sets `deletedAt`). 409 if already deleted.                                                            |
| POST   | `/api/v1/tasks/:id/restore`     | Clear `deletedAt`. 409 if task is not deleted.                                                                     |

**Body fields for create/update:**

- `title`: string, required on create, 1–500 chars
- `targetDate`: string `"YYYY-MM-DD"`, optional (defaults to today in user's TZ)
- `notes`: string, optional, max 5000 chars
- `priority`: `"low" | "medium" | "high"`, optional
- `completed`: boolean (update only)
- `isPartial`: boolean (update only)

**Response (task object):**

```json
{
  "id": "cmpg...",
  "userId": "demo-user-1",
  "title": "Patient rounds at 8am",
  "targetDate": "2026-05-22T00:00:00.000Z",
  "priority": "high",
  "completed": false,
  "isPartial": false,
  "notes": null,
  "aiFeedback": null,
  "sourceType": "manual",
  "sourceId": null,
  "createdAt": "...",
  "updatedAt": "...",
  "deletedAt": null
}
```

`sourceType` is `"manual" | "voice" | "image" | "text" | "unified"` — tells you how the task was originally created. `sourceId` links AI-created tasks back to their VoiceInteraction / ImageExtraction / TextInteraction / UnifiedInteraction record.

### Notes

| Method | Path                        | Purpose                                        |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/notes`             | List active notes (not archived, not deleted)  |
| POST   | `/api/v1/notes`             | Create. Body: `{content}` (1–10000 chars)      |
| PATCH  | `/api/v1/notes/:id`         | Update content                                 |
| POST   | `/api/v1/notes/:id/archive` | Set `archived: true`. 409 if already archived. |
| DELETE | `/api/v1/notes/:id`         | Soft delete                                    |

### Holidays

| Method | Path                               | Purpose                                                                    |
| ------ | ---------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/api/v1/holidays?from=...&to=...` | List holidays in range (both dates required, `from` ≤ `to`)                |
| POST   | `/api/v1/holidays/toggle`          | Body: `{date, reason?}`. Adds if absent (201) or removes if present (200). |

### Voice processing

| Method | Path                    | Purpose                                                                                      |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/voice/process` | Multipart audio → AI intent classification → executes task actions + returns recommendations |

**Multipart fields:**

- `audio` (file, required): WebM, WAV, MP3, OGG, MP4, M4A. Max 25 MB.

**Response:** see use case 4.1 above.

**Response fields:**

- `voiceInteractionId`: id of the persisted audit row
- `transcript`: verbatim transcription in Hinglish/English Roman script
- `actions`: array of executed actions (already written to DB). Each has `type`, `taskId`, modality-specific fields, and `reasoning`.
- `recommendations`: array of suggestions the AI was unsure about. **Backend wrote nothing for these** — frontend must show Add/Skip UI and call `POST /tasks` if user accepts.

### Image processing

| Method | Path                     | Purpose                                          |
| ------ | ------------------------ | ------------------------------------------------ |
| POST   | `/api/v1/images/process` | Multipart image → AI OCR + intent classification |

**Multipart fields:**

- `image` (file, required): JPEG, PNG, WebP, HEIC, HEIF. Max 15 MB.

**Response:** similar to voice, with `extractedText` instead of `transcript`. See use case 4.2.

### Text processing

| Method | Path                   | Purpose                                                                                          |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/api/v1/text/process` | JSON text paragraph → AI intent classification → executes task actions + returns recommendations |

**Request body (JSON):**

- `text` (string, required): 1–5000 characters. Free-form paragraph; Hinglish supported.

**Response fields:**

- `textInteractionId`: id of the persisted `TextInteraction` audit row
- `actions`: array of executed actions (already written to DB). Each has `type`, `taskId`, modality-specific fields, and `reasoning`. No `transcript` field — unlike voice, the input text is not re-transcribed.
- `recommendations`: suggestions the AI was unsure about. Backend wrote nothing for these.

See use case 4.8 for a full example.

### Unified multimodal processing (`/process`)

| Method | Path              | Purpose                                                                                           |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/process` | Multipart with any combination of `audio` + `image` + `text` → single Vertex call, fused response |

**Multipart fields (all optional, but at least one required):**

- `audio` (file): WebM, WAV, MP3, OGG, MP4, M4A. Max 25 MB.
- `image` (file): JPEG, PNG, WebP, HEIC, HEIF. Max 15 MB.
- `text` (body field): string, min 1 char, max 5000 chars.

If all three are absent: `400 VALIDATION_ERROR` — "At least one of audio, image, or text must be provided."

**Response fields:**

- `unifiedInteractionId`: id of the persisted `UnifiedInteraction` audit row.
- `actions`: array of executed actions. Each item has `type`, `taskId`, modality-specific fields, `reasoning`, and **`source: "voice" | "image" | "text"`** indicating which modality contributed the action.
- `recommendations`: suggestions the AI was unsure about. Same `source` tag present. Backend wrote nothing for these.

**Deliberately absent fields:**

- `transcript` is **not returned**, even if audio was sent.
- `extractedText` is **not returned**, even if an image was sent.

_Rationale:_ dropping these top-level fields prevents the OCR-then-classify cascade hallucination, where a transcription/OCR error in one step compounds into incorrectly classified actions in the next. The per-action `reasoning` field captures the relevant modality cue inline, which is more actionable for the frontend than a raw dump.

See use case 4.9 for a full example and cross-modal grounding behavior.

### Day plan

| Method | Path                               | Purpose                                                                                           |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/day-plan/submit`          | Snapshot today's tasks. Body: `{date?}` (default: today). 409 if already submitted for that date. |
| GET    | `/api/v1/day-plan?date=YYYY-MM-DD` | Retrieve submitted plan. 404 if none.                                                             |

### Day closure

| Method | Path                                  | Purpose                                                                                                                         |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/day-closure/submit`          | Multipart audio + typed commentary → voice flow + AI feedback. 409 if no plan exists for the date or closure already submitted. |
| GET    | `/api/v1/day-closure?date=YYYY-MM-DD` | Retrieve submitted closure. 404 if none.                                                                                        |

**Multipart fields for submit:**

- `audio` (file, required): same MIME whitelist as voice (WebM, WAV, MP3, OGG, MP4, M4A; max 25 MB)
- `commentary` (text, optional): up to 5000 chars
- `date` (text, optional): defaults to today

---

## 6. AI features in detail

### Multilingual & Hinglish output

The user may speak/write in English, Hindi (Devanagari), or Hinglish (Roman-script mix). **All generated output text — task titles, transcripts, reasoning, AI feedback — is in Hinglish/English Roman script.** Devanagari is never produced by the backend, even if the input was Devanagari.

Examples of what the AI produces:

- `"Patient ke rounds complete kar diye"` ✓
- `"Finished patient rounds"` ✓
- `"मरीज़ के राउंड पूरे कर लिए"` ✗ (never)

### The recommendation pattern

When the AI is uncertain whether a phrase is a real task, or when the user mentions doing ad-hoc work not on the plan, the result goes into `recommendations` instead of `actions`. **The backend writes nothing for recommendations.** The frontend should:

1. Render Add / Skip buttons next to each recommendation.
2. If user taps Add, call `POST /api/v1/tasks` with the recommended fields.
3. If user taps Skip, just discard.

This pattern is **the safety net for AI mistakes**: even if the AI hallucinates, no data is written without user confirmation.

### Task ID handling — server-generated only

- For `created` actions, the AI returns `title` but NO `taskId`. The backend creates the task with a Prisma-generated `cuid()` ID and returns that ID in the response.
- For `completed` / `partial` / `priority_updated` actions, the AI must reference an ID that came from the pending-tasks list we sent in the prompt. If it invents an ID, the backend will throw `404 TASK_NOT_FOUND` and fail loudly rather than mutate the wrong task.

Frontend can trust IDs returned by the backend; never trust IDs the user (or AI) might forge.

---

## 7. What's NOT supported yet

These are intentional deferrals for the POC. Frontend should not expect any of these.

| Feature                                                            | Status                                                           | When                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| **File / media storage** (audio + image persistence)               | Audio/image bytes are sent to AI but not stored                  | Deferred — needs GCS bucket + IAM      |
| **Task media attachments** (proof-of-work photos/videos on a task) | Schema exists, no endpoints                                      | Deferred with file storage             |
| **General uploads endpoint** (`POST /uploads`)                     | Not built                                                        | Deferred with file storage             |
| **Alerts inbox** (manual + AI-generated notifications)             | Schema exists, no endpoints                                      | Sprint 8 deferred indefinitely for POC |
| **History search** (`GET /history?q=...`)                          | Not built                                                        | Sprint 8 deferred                      |
| **Multi-user / manager-staff hierarchy**                           | Schema supports it (`role`, `orgId` columns), but no enforcement | Production milestone                   |
| **Real-time / live captions / streaming AI responses**             | All HTTP is request/response, single response per call           | Future iteration                       |
| **OpenAPI / Swagger spec**                                         | None — read this guide + the route files                         | Add when client integration matures    |
| **Rate limiting**                                                  | None                                                             | Add when multi-user lands              |
| **Logging / observability** (structured logs, request IDs)         | `console.*` only                                                 | Add when staging deploy happens        |
| **Edit/delete a submitted plan or closure**                        | Forbidden by design                                              | Add if real users push back            |
| **Multiple plans per day**                                         | Forbidden by `@@unique([userId, date])`                          | Add `PATCH /day-plan/:date` if needed  |
| **Alerts on overdue / forgotten tasks**                            | Not built                                                        | Part of deferred Sprint 8              |

---

## 8. Quick-start for developers

### Prerequisites

- **Node 22+**, **npm 10+**
- **Docker** running locally (for Postgres) OR a hosted Postgres
- **Google Cloud project** with Vertex AI enabled + a service account JSON key
- **`.env`** file in the project root with at least:
  ```
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tasklist"
  GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
  GOOGLE_CLOUD_PROJECT=your-gcp-project-id
  GOOGLE_CLOUD_LOCATION=us-central1
  JWT_SECRET=replace-with-at-least-32-random-characters
  JWT_TTL=30d
  PORT=3000
  NODE_ENV=development
  ```

### Spin up Postgres in Docker

```bash
docker run -d --name task-list-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tasklist \
  -p 5432:5432 \
  -v task-list-pgdata:/var/lib/postgresql \
  postgres:18
```

### Install + migrate + seed + run

```bash
npm install                  # also runs prisma generate
npx prisma migrate dev       # applies all migrations
npx prisma db seed           # creates the demo user
npm run dev                  # starts dev server on PORT (default 3000)
```

### First request — confirm everything works

```bash
curl http://localhost:3000/livez
# → {"status":"ok"}

curl http://localhost:3000/readyz
# → {"status":"ok","checks":{"db":"ok"}}

TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@kims.local","password":"demopass123"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"My first task","priority":"high"}'
# → 201 with the new task object
```

### Useful npm scripts

| Command              | What it does                              |
| -------------------- | ----------------------------------------- |
| `npm run dev`        | Run with hot reload via `tsx watch`       |
| `npm run build`      | Compile to `dist/`                        |
| `npm start`          | Run the compiled output (production-like) |
| `npm run db:migrate` | `prisma migrate dev`                      |
| `npm run db:studio`  | Open Prisma Studio (DB GUI in browser)    |
| `npm run typecheck`  | `tsc --noEmit`                            |
| `npm run lint`       | ESLint                                    |
| `npm run format`     | Prettier                                  |

---

## 9. Where to look in the code

If the frontend team wants to understand how a specific endpoint behaves:

| Concern                                       | Path                                          |
| --------------------------------------------- | --------------------------------------------- |
| Route definitions (URL → controller)          | `src/routes/*.routes.ts` + `src/routes/v1.ts` |
| Request parsing + response formatting         | `src/controllers/*.controller.ts`             |
| Business logic (framework-agnostic)           | `src/services/*.service.ts`                   |
| Database access (only place Prisma is called) | `src/repositories/*.repository.ts`            |
| Input validation schemas (zod)                | `src/schemas/*.ts`                            |
| AI prompts (Vertex / Gemini)                  | `src/lib/prompts/*.ts`                        |
| Error class hierarchy                         | `src/lib/errors.ts`                           |
| Prisma schema (data model)                    | `prisma/schema.prisma`                        |

For architectural rationale on any decision, see `.agents/decisions/` (ADRs, 20+ files indexed by `.agents/README.md`).

---

## 10. Open questions / things to confirm with backend before frontend builds against them

If your frontend team is about to build against any of these, sync with backend first:

- **`POST /voice/process` accepting bundled images.** This specific endpoint remains audio-only. If you need audio + image together, use `POST /process` (the unified multimodal endpoint) instead — it accepts any combination of audio, image, and text in a single call.
- **Per-action confidence scores.** Today: actions are confident, recommendations are not (binary). If frontend wants a 0–1 confidence number per item, see [.agents/decisions/](.agents/decisions/) for the reasoning — we deliberately did not add this because models fabricate it.
- **Idempotency keys** for accidental double-submits (e.g., user double-clicks "Submit Plan"). Today: relies on the 409 from the unique constraint. Could add `Idempotency-Key` header if double-clicks are a real UX issue.
- **WebSocket / SSE streaming** for long AI responses. Today: one HTTP response. Day-closure can take ~15s; if perceived latency is a problem, we can stream partial responses.

---

## Questions or feedback

This document is at `Backend_task_list/BACKEND_GUIDE.md`. If anything is unclear, missing, or wrong, raise it — the doc is meant to be the single source of truth for "what the backend supports."
