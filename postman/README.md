# Task List Postman Handoff

This folder is for frontend and QA testing. It gives Postman a runnable demo flow, not just endpoint skeletons.

## Files

- `task-list-api.postman_collection.json` - requests, descriptions, tests, and demo-data flow.
- `task-list-local.postman_environment.json` - local variables for `http://localhost:3000`.

## Import

1. Open Postman.
2. Click `Import`.
3. Select both JSON files from this folder.
4. Select the `Task List Local` environment in the top-right environment dropdown.

## Before running requests

From `Backend_task_list`:

```powershell
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

The seed currently creates the demo user only:

- `demo-user-1`
- `demo@kims.local`
- `demo-org`

The Postman collection creates the actual task/note/holiday/day-plan demo rows through API calls.

## Fastest demo

In Postman, open the collection and run the folder:

```text
00 Run This Demo Flow In Order
```

That folder does this:

1. Checks `/livez`.
2. Checks `/readyz` so you know Postgres is connected.
3. Creates three demo tasks for a generated demo date:
   - high priority patient rounds
   - medium priority lab report follow-up
   - low priority discharge summary
4. Lists the tasks.
5. Submits the morning day-plan snapshot.
6. Fetches the day-plan snapshot.
7. Marks one task complete.
8. Marks one task partial.
9. Soft-deletes and restores one task.
10. Creates, updates, and lists a note.
11. Adds and lists a holiday.

The first request generates a fresh future `date` and `runId` each time. This avoids day-plan duplicate errors when you rerun the demo.

## Variables captured automatically

The collection tests save these after successful requests:

- `taskId`
- `noteId`
- `morningRoundsTaskId`
- `labReportsTaskId`
- `dischargeSummaryTaskId`
- `dayPlanId`
- `activeNoteId`

Frontend devs can use the later requests immediately because IDs are filled automatically by the earlier requests.

## Useful folders

- `00 Run This Demo Flow In Order` - creates usable demo data.
- `01 Common API Requests` - one-off CRUD requests for tasks, notes, holidays, and day plans.
- `02 Optional AI And File Uploads` - text/voice/image/fusion/day-closure requests. These need Vertex credentials and/or local files.
- `03 Error Shape Examples` - intentional 400/404/409 examples for frontend error handling.

## File upload requests

Postman usually does not preserve local file paths after import. For upload requests, manually choose files in the form-data field:

- `audio` field: `fusion-audio.wav`
- `image` field: `fusion-image.png`

Those files live in the `Backend_task_list` root.

## What the backend does

This backend is a daily task-tracking POC for hospital staff.

- Users create tasks manually or through AI input: text, voice, image, or a fused multimodal request.
- Morning flow: create tasks, then submit a day-plan snapshot.
- Day flow: update, complete, partially complete, delete, or restore tasks.
- Notes are standalone sticky notes.
- Holidays are user-specific date markers.
- Evening flow: submit audio closure, compare against the day plan, and receive structured Hinglish AI feedback.

Important conventions:

- Base URL: `{{baseUrl}}`, default `http://localhost:3000`
- Stub auth header: `X-User-Id: {{userId}}`, default `demo-user-1`
- API prefix: `/api/v1`
- Health endpoints are unversioned: `/livez`, `/readyz`
- JSON endpoints use `application/json`
- File endpoints use `multipart/form-data`

For the complete backend reference, read `../BACKEND_GUIDE.md`.
