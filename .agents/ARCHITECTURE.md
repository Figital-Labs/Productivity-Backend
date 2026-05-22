---
id: ARCHITECTURE
title: Data Model, API Surface, Folder Structure, AI Flows
status: stable
date: 2026-05-22
tags: [architecture, schema, api]
related: [PRODUCT, GLOSSARY]
---

# Architecture

## Folder Structure

```
Backend_task_list/
├── prisma/
│   ├── schema.prisma                 # data model below
│   └── migrations/
├── src/
│   ├── routes/                       # HTTP framing only
│   ├── controllers/                  # orchestrates services
│   ├── services/                     # business logic, framework-agnostic
│   ├── repositories/                 # only place Prisma is called
│   ├── schemas/                      # zod schemas (input + output)
│   ├── middleware/
│   │   ├── auth.ts                   # stub: reads X-User-Id
│   │   ├── error.ts                  # central error handler
│   │   ├── idempotency.ts
│   │   └── upload.ts                 # multer setup
│   ├── lib/
│   │   ├── prisma.ts                 # existing
│   │   ├── vertex.ts                 # Vertex AI client + prompt templates
│   │   ├── storage/
│   │   │   ├── index.ts              # BlobStorage interface
│   │   │   └── gcs.ts                # GCS implementation
│   │   └── errors.ts                 # AppError class hierarchy
│   ├── config/
│   │   └── env.ts                    # zod-validated env loader
│   ├── utils/
│   │   ├── auth.ts                   # canAccess(user, resource)
│   │   └── date.ts                   # user-tz-aware "today"
│   ├── app.ts                        # createApp() factory
│   └── index.ts                      # boots createApp + listen + signal handlers
├── secrets/                          # gitignored, holds vertex-sa.json
├── .agents/                          # this directory
├── .env
├── package.json
└── tsconfig.json
```

The boundary rule: **dependencies only point inward.**
- Routes depend on controllers; controllers depend on services; services depend on repositories.
- The reverse direction is forbidden. A service must not import an Express type. A repository must not call out to Vertex.

See [ADR-0007](./decisions/0007-layered-architecture.md).

---

## Data Model

All entities have `id` (cuid), `userId` foreign key, `createdAt`, `updatedAt`, `deletedAt?` (soft delete where applicable).

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  role      String   @default("staff")    // "staff" | "manager" | "admin" — for future
  orgId     String                         // single seed org for POC
  timezone  String   @default("Asia/Kolkata")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Task {
  id          String    @id @default(cuid())
  userId      String
  title       String
  targetDate  DateTime  @db.Date           // user's local date (defaults to today)
  priority    String?                       // "low" | "medium" | "high", AI-assigned
  completed   Boolean   @default(false)
  isPartial   Boolean   @default(false)
  notes       String?
  aiFeedback  String?                       // populated by day-closure AI review
  sourceType  String                        // "manual" | "voice" | "image" | "text" | "unified"
  sourceId    String?                       // links to VoiceInteraction / ImageExtraction / TextInteraction / UnifiedInteraction
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  media       TaskMedia[]
  user        User       @relation(fields: [userId], references: [id])
  @@index([userId, targetDate])
  @@index([userId, deletedAt])
}

model TaskMedia {
  id        String   @id @default(cuid())
  taskId    String
  type      String   // "image" | "video" | "audio"
  url       String   // gs:// URI (see ADR-0009)
  createdAt DateTime @default(now())
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
}

model Note {
  id        String    @id @default(cuid())
  userId    String
  content   String
  archived  Boolean   @default(false)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  @@index([userId, deletedAt])
}

model Alert {
  id          String    @id @default(cuid())
  userId      String
  title       String
  description String
  type        String    // "task" | "meeting" | "system"
  source      String    // "manual" | "ai"
  createdAt   DateTime  @default(now())
  dismissedAt DateTime?
  @@index([userId, dismissedAt])
}

model Holiday {
  userId String
  date   DateTime @db.Date
  reason String?
  @@id([userId, date])
}

model DayPlanSubmission {
  id           String   @id @default(cuid())
  userId       String
  date         DateTime @db.Date
  submittedAt  DateTime @default(now())
  taskSnapshot Json     // immutable array of {id, title, priority, ...}
  @@unique([userId, date])
}

model DayClosureSubmission {
  id          String   @id @default(cuid())
  userId      String
  date        DateTime @db.Date
  submittedAt DateTime @default(now())
  commentary  String
  aiFeedback  Json     // {achievements, additions, missed, partial, tips, summary}
  mediaIds    String[]
  @@unique([userId, date])
}

model VoiceInteraction {
  id               String   @id @default(cuid())
  userId           String
  audioUrl         String
  transcript       String
  actions          Json     // [{type: 'created'|'priority_updated'|'completed'|'partial', ...}]
  recommendations  Json     // [{title, priority, reasoning}]
  createdAt        DateTime @default(now())
}

model ImageExtraction {
  id              String   @id @default(cuid())
  userId          String
  imageUrl        String
  actions         Json
  recommendations Json
  createdAt       DateTime @default(now())
}

model TextInteraction {
  id              String   @id @default(cuid())
  userId          String
  inputText       String   // the raw text the user submitted
  actions         Json
  recommendations Json
  createdAt       DateTime @default(now())
}

model UnifiedInteraction {
  id              String   @id @default(cuid())
  userId          String
  inputText       String?  // typed text component (nullable — user may send audio/image only)
  audioUrl        String?  // deferred (GCS not yet wired)
  imageUrl        String?  // deferred (GCS not yet wired)
  actions         Json     // persisted with per-action source tags
  recommendations Json
  createdAt       DateTime @default(now())
}
```

### Notes on the model
- `Task.sourceType` + `sourceId`: audit trail back to the voice/image/text/unified interaction that produced this task.
- `TextInteraction`: mirrors `VoiceInteraction` minus the audio fields. `inputText` stores the raw user paragraph; no transcript column needed.
- `UnifiedInteraction`: audit row for fusion calls. `audioUrl`/`imageUrl` are nullable because GCS storage is still deferred; the bytes are sent to Vertex inline but not persisted. The `actions` JSON carries per-action `source` provenance (not on the `Task` row itself, which only knows `sourceType: "unified"`).
- `DayPlanSubmission.taskSnapshot`: per [ADR-0011](./decisions/0011-submit-snapshot.md), this is the immutable record of what the user committed to at submit time.
- `Holiday`: composite primary key `(userId, date)`. No surrogate id needed.
- All `@@index` entries are on the columns that will dominate WHERE clauses.

---

## API Surface (v1)

All routes under `/api/v1/`. All responses JSON. Standard error shape:

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "...", "details": {} } }
```

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/livez` | Liveness probe (no deps) |
| GET | `/readyz` | Readiness probe (checks DB) |

### Tasks
| Method | Path | Purpose |
|---|---|---|
| GET | `/tasks?date=YYYY-MM-DD` | List tasks for a date (default today in user's TZ) |
| POST | `/tasks` | Create task manually `{title, targetDate?, notes?, priority?}` |
| PATCH | `/tasks/:id` | Update task (title, notes, completed, isPartial, priority) |
| DELETE | `/tasks/:id` | Soft delete (sets `deletedAt`) |
| POST | `/tasks/:id/restore` | Clear `deletedAt` |
| POST | `/tasks/:id/media` | Attach media (multipart) |
| DELETE | `/tasks/:id/media/:mediaId` | Detach media |

### Voice / Image / Text / Unified Processing
| Method | Path | Purpose |
|---|---|---|
| POST | `/voice/process` | General-purpose voice action endpoint. Multipart audio. Backend includes top 20–100 pending tasks as context. Returns `{transcript, actions, recommendations}`. Persists `VoiceInteraction`. See [ADR-0003](./decisions/0003-voice-intent-classification.md). |
| POST | `/images/process` | Multipart image → Gemini Vision. Same response shape minus transcript, with `extractedText`. Persists `ImageExtraction`. |
| POST | `/text/process` | JSON body `{text}`. AI intent classification on a typed paragraph (Hinglish supported). Same action/recommendation shape as voice, no `transcript` field (the input IS the text). Persists `TextInteraction`. |
| POST | `/process` | Unified multimodal fusion. Multipart with optional `audio`, `image`, and/or body `text` — at least one required. Single Vertex `generateContent` call across all modalities; each action/recommendation carries `source: "voice"｜"image"｜"text"`. No `transcript` or `extractedText` in response (cascade-hallucination rationale; see ADR-0021). Persists `UnifiedInteraction`. |

### Day Plan / Closure
| Method | Path | Purpose |
|---|---|---|
| POST | `/day-plan/submit` | `{date?}` → snapshots today's tasks. Returns submission record. |
| GET | `/day-plan?date=YYYY-MM-DD` | Get day plan submission if exists |
| POST | `/day-closure/submit` | Multipart audio + `{commentary?, mediaIds?, date?}`. Internally reuses voice intent classification, **plus** generates structured AI feedback. Returns `{transcript, taskUpdates, recommendedNewTasks, aiFeedback}`. |
| GET | `/day-closure?date=YYYY-MM-DD` | Get day closure submission if exists |

### Notes
| Method | Path | Purpose |
|---|---|---|
| GET | `/notes` | List notes |
| POST | `/notes` | Create `{content}` |
| PATCH | `/notes/:id` | Update |
| POST | `/notes/:id/archive` | Archive (sets `archived=true`) |
| DELETE | `/notes/:id` | Soft delete |

### Alerts
| Method | Path | Purpose |
|---|---|---|
| GET | `/alerts` | List active alerts (`dismissedAt` null) |
| POST | `/alerts` | Create manually |
| POST | `/alerts/generate` | Gemini analyzes current tasks → creates AI alerts |
| POST | `/alerts/:id/dismiss` | Set `dismissedAt` |

### Holidays
| Method | Path | Purpose |
|---|---|---|
| GET | `/holidays?from=...&to=...` | List holidays in range |
| POST | `/holidays/toggle` | `{date, reason?}` → add or remove |

### History
| Method | Path | Purpose |
|---|---|---|
| GET | `/history?type=tasks\|notes&q=search&limit=50&cursor=...` | Cursor-paginated search across past entities |

### Uploads
| Method | Path | Purpose |
|---|---|---|
| POST | `/uploads` | Multipart file → returns `{url, type}`. Backed by `BlobStorage`. |

All mutating POSTs accept `Idempotency-Key` header. See [ADR-0017](./decisions/0017-idempotency-keys.md).

---

## AI Flows (Detailed)

### Voice Flow (`POST /voice/process`)

```
┌──────────┐                                                     ┌──────────┐
│ Frontend │                                                     │ Backend  │
└────┬─────┘                                                     └────┬─────┘
     │  POST /voice/process (multipart: audio[, images, text])       │
     │ ────────────────────────────────────────────────────────────► │
     │                                                              │
     │                                                              │
     │                          1. Load top 20–100 pending tasks    │
     │                             for the user as context          │
     │                                                              │
     │                          2. Call Vertex Gemini 2.5 Flash     │
     │                             with audio + context tasks       │
     │                             Prompt: "for each phrase, classify│
     │                             intent → created / priority_updated│
     │                             / completed / partial; or put    │
     │                             into recommendations if unsure"  │
     │                                                              │
     │                          3. For each action returned:        │
     │                             call repository method that      │
     │                             matches (taskRepo.create,        │
     │                             taskRepo.updatePriority, etc.)   │
     │                                                              │
     │                          4. Persist VoiceInteraction         │
     │                                                              │
     │  ◄──────────────────────────────────────────────────────────│
     │  { transcript, actions: [...], recommendations: [...] }      │
```

### Image Flow (`POST /images/process`)

Same as voice, but the input is an image and the model used is Gemini Vision. Used primarily for handwritten task sheet OCR.

### Day Closure Flow (`POST /day-closure/submit`)

```
1. Frontend uploads: audio + optional text commentary + optional mediaIds
2. Backend reuses the voice intent classification service (same as /voice/process)
3. Backend makes a SECOND Vertex call to generate structured aiFeedback:
   { achievements, missed, partial, additions, tips, summary }
4. Persists DayClosureSubmission with everything
5. Returns: { transcript, taskUpdates, recommendedNewTasks, aiFeedback }
```

Note: `recommendedNewTasks` is NOT auto-created. Frontend shows them as opt-in items; user taps Add or Skip. If Add, frontend POSTs to `/tasks`. See [ADR-0005](./decisions/0005-recommendation-pattern.md).

### Text Flow (`POST /text/process`)

Same as voice, except input is a JSON body `{ text }` instead of a multipart audio file. No media passed to Vertex — the text is inlined in the prompt body. Persists `TextInteraction`. Response shape is identical to voice minus `transcript`.

### Unified Fusion Flow (`POST /process`)

```
1. Frontend sends multipart: any combination of audio file, image file, text body field
2. Controller validates at least one modality present; 400 if all absent
3. Backend creates empty UnifiedInteraction row (for sourceId referencing)
4. Builds media[] array from whichever files are present
5. Single Vertex generateContent call with:
   - all media buffers as inline attachments
   - fusion prompt (modality-aware: lists which inputs are present this call)
   - pending task context (top 50)
6. For each action returned: dispatch via shared dispatchAiAction (sourceType: "unified")
   Per-action source tag (voice|image|text) is re-attached after dispatch
7. Patch UnifiedInteraction with final actions + recommendations
8. Returns: { unifiedInteractionId, actions (with source), recommendations (with source) }
   NOTE: no transcript or extractedText — see ADR-0021
```

See [ADR-0021](./decisions/0021-multimodal-fusion-composer.md) for the full decision record.
