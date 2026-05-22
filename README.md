# Backend Task List — POC

A daily work-tracking backend for hospital staff. Users add tasks (by voice, image, or manual entry), commit a morning plan, and submit an evening closure that gets compared against the plan by an AI assistant. All AI output is in **Hinglish**.

This README covers **setting up the repo and contributing**. For **using the API** (frontend integration, endpoint reference, user journeys), see **[BACKEND_GUIDE.md](./BACKEND_GUIDE.md)**.

---

## TL;DR

```bash
# 1. Clone and install
git clone <repo-url>
cd Backend_task_list
cp .env.example .env          # then edit .env with your real values
npm install                   # auto-generates the Prisma client via postinstall

# 2. Start Postgres (Docker)
docker run -d --name task-list-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tasklist -p 5432:5432 \
  -v task-list-pgdata:/var/lib/postgresql \
  postgres:18

# 3. Migrate + seed
npx prisma migrate dev
npx prisma db seed

# 4. Run
npm run dev                   # http://localhost:3000
```

Verify with `curl http://localhost:3000/livez` → `{"status":"ok"}`.

---

## Prerequisites

- **Node 22+** and **npm 10+** (`node -v` to check)
- **Docker** (for the local Postgres container; you can also use a hosted Postgres)
- **A Google Cloud project** with:
  - **Vertex AI API enabled**
  - **A service account** with role `roles/aiplatform.user`
  - **A JSON key** for that service account (downloaded as a `.json` file from the GCP console)
- **No global Prisma install needed** — we use the local one via `npx`.

---

## Gotchas (read this before debugging setup issues)

These are things that have actually bitten contributors. Most are handled automatically, but worth knowing in case something goes sideways:

### 1. The Prisma client is gitignored — you must generate it locally

The generated Prisma client lives at `src/generated/prisma/`. It's `.gitignore`d (line `generated` matches it) because generated code shouldn't be in version control.

**This is handled automatically by `npm install`** via the `postinstall` script in [package.json](./package.json), which runs `prisma generate` for you.

**You need to manually run `npx prisma generate` if:**

- You ran `npm ci --ignore-scripts` (skips postinstall)
- You pulled commits that changed `prisma/schema.prisma`
- TypeScript suddenly can't find `../generated/prisma/...` imports
- The `Task` / `Note` / etc. types look stale after a schema change

Symptom of stale client: typecheck fails with `Module has no exported member 'Task'` or similar.

### 2. `.env` is gitignored — never commit secrets

Copy `.env.example` to `.env` and fill in your actual values. The repo's existing `.env` (if present locally) contains real Vertex credentials and **must never be committed**. The pre-commit hook does NOT block this — it's your responsibility.

### 3. Service account credentials go INLINE in the env var, not as a file path

`GOOGLE_SERVICE_ACCOUNT_JSON` is the literal JSON string, single-quoted. NOT a path to a JSON file.

```bash
# ✓ Correct — single-quoted JSON
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"..."}'

# ✗ Wrong — this is a file path, will fail
GOOGLE_SERVICE_ACCOUNT_JSON=./secrets/sa.json
```

Why inline? Better for PaaS portability (Render, Railway, Fly.io, Cloud Run all read env vars; none of them have a "mount a JSON file" pattern). See `.agents/decisions/0002-vertex-credentials.md` for the full reasoning.

**Single-quoting matters** — it stops dotenv from expanding `$` and processing escape sequences. The newlines inside `private_key` are literal `\n` characters that need to survive into the env var as-is.

### 4. Postgres 18 changed its volume mount convention

If you're using Postgres 17 or earlier examples from the internet, you'll see `-v ...:/var/lib/postgresql/data`. **Postgres 18 changed this** — the mount path is now `/var/lib/postgresql` (one level up). Using the old path produces a "PostgreSQL data in unused mount/volume" error and the container won't stay up.

The Docker command in TL;DR above uses the correct PG18 path.

### 5. Husky pre-commit hook will reject your commit if lint or formatting fails

`.husky/pre-commit` runs `npx lint-staged` which runs `eslint --fix` and `prettier --write` on staged files. If either fails:

- For lint errors: fix the warnings and re-stage (lint-staged auto-stages the fixes when `--fix` resolves them, but blocks if there are unfixable errors).
- For formatting: usually resolves itself on the second commit attempt since Prettier auto-fixes.
- **Don't use `--no-verify` to bypass.** If a hook fails, investigate the underlying issue.

### 6. Generated Prisma types use `<ModelName>Model` not `<ModelName>`

In Prisma 7, the row type for a model is `TaskModel`, not `Task`. This is different from Prisma 6 and earlier.

```typescript
// ✓ Correct
import type { TaskModel } from "../generated/prisma/models.js";

// ✗ Wrong — will fail with "no exported member 'Task'"
import type { Task } from "../generated/prisma/models.js";
```

The repository files re-export as plain `Task` / `Note` / etc. for ergonomic use within the rest of the app — see `src/repositories/task.repository.ts` for the pattern.

### 7. NodeNext ESM requires `.js` extensions in TypeScript imports

You'll see this everywhere:

```typescript
import { stubAuth } from "./middleware/auth.js"; // ← .js, NOT .ts
```

This is **correct** for our `module: "nodenext"` + `verbatimModuleSyntax: true` setup. The path refers to the runtime filename (`.js` after compilation), not the source filename (`.ts`). TypeScript's resolver handles the lookup. See `.agents/CONVENTIONS.md` for the full explanation.

---

## Project structure

```
Backend_task_list/
├── prisma/
│   ├── schema.prisma                 # data model — all 10 entities
│   ├── seed.ts                       # demo user seed
│   └── migrations/                   # generated, committed
├── src/
│   ├── routes/                       # HTTP framing only
│   ├── controllers/                  # parse req, call service, format response
│   ├── services/                     # business logic, framework-agnostic
│   ├── repositories/                 # ONLY place Prisma is called
│   ├── schemas/                      # zod schemas (input + output)
│   ├── middleware/                   # auth, error, upload
│   ├── lib/                          # vertex client, prompts, errors, prisma singleton
│   ├── utils/                        # canAccess, date, object helpers
│   ├── config/                       # env loader
│   ├── generated/                    # GITIGNORED — Prisma client
│   ├── app.ts                        # createApp() factory
│   └── index.ts                      # boot + signal handlers
├── .agents/                          # agent-native docs (also useful for humans)
│   ├── README.md                     # entry point for AI sessions
│   ├── CONVENTIONS.md                # code + commit conventions
│   ├── ARCHITECTURE.md               # data model, folder rules, AI flows
│   ├── STATE.md                      # live project state, changelog
│   ├── PRODUCT.md, SCOPE.md, GLOSSARY.md
│   ├── decisions/                    # 20+ ADRs
│   └── sprints/                      # sprint detail files
├── BACKEND_GUIDE.md                  # for frontend devs / product owner
├── README.md                         # this file
├── .env.example                      # template; copy to .env and fill in
├── package.json
├── tsconfig.json
└── eslint.config.js
```

**Layered architecture rule:** dependencies point inward only.

```
routes  →  controllers  →  services  →  repositories  →  Postgres
```

Routes import controllers. Controllers import services. Services import repositories. Reverse imports are forbidden — a service must never import an Express type; a repository must never call Vertex. The eslint config doesn't enforce this yet; rely on code review.

See `.agents/decisions/0007-layered-architecture.md` for the full rationale.

---

## Development workflow

### Available npm scripts

| Command                   | What it does                                               |
| ------------------------- | ---------------------------------------------------------- |
| `npm run dev`             | Run with hot reload (`tsx watch src/index.ts`)             |
| `npm run build`           | `prisma generate && tsc` → `dist/`                         |
| `npm start`               | Run the compiled output (production-like)                  |
| `npm run db:migrate`      | `prisma migrate dev` — creates + applies migration         |
| `npm run db:deploy`       | `prisma migrate deploy` — applies, never creates (CI/prod) |
| `npm run db:studio`       | Opens Prisma Studio in the browser (DB GUI)                |
| `npm run prisma:generate` | Regenerate the Prisma client (rarely needed manually)      |
| `npm run typecheck`       | `tsc --noEmit` — strict type check, no emit                |
| `npm run lint`            | ESLint                                                     |
| `npm run lint:fix`        | ESLint with auto-fix                                       |
| `npm run format`          | Prettier write on all source files                         |
| `npm run format:check`    | Prettier check without writing                             |

### Code conventions (the short version)

- **TypeScript strict mode + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`** — don't disable
- **Named exports only.** No default exports (except the legacy `src/lib/prisma.ts`)
- **Files: `kebab-case.ts` + optional dotted descriptor** (`task.service.ts`, `tasks.routes.ts`)
- **Variables/functions: `camelCase`** — Types/classes: `PascalCase`
- **Imports use `.js` extensions** even for `.ts` files (NodeNext ESM convention)
- **`import type` for type-only imports** (required by `verbatimModuleSyntax`)
- **Throw `AppError` subclasses for HTTP errors**, never raw `Error` or strings
- **No `as any`, no `// @ts-ignore`.** If TypeScript complains, fix the types

Full convention list: [`.agents/CONVENTIONS.md`](./.agents/CONVENTIONS.md).

### Commit conventions

We follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
feat(tasks): add restore endpoint
fix(voice): handle empty Gemini response
chore(deps): bump @google/genai to 2.5.1
docs(readme): document Prisma 7 client path
refactor(services): extract dispatchAiAction to shared helper
```

- Scope = the area touched (folder, feature, or sprint number)
- Reference ADRs and sprint numbers in the body when relevant (`Per ADR-0009, ...`)
- One logical change per commit — don't pile features together
- Don't use `--amend` on pushed commits or `--force` push without coordination
- Don't bypass hooks with `--no-verify`

### Sprint workflow

Work has historically been broken into small sprints, each with a detail file in `.agents/sprints/`. The pattern was:

1. Draft the sprint detail file (`.agents/sprints/NN-slug.md`) before coding.
2. Get plan approval at sync points before installing deps / writing new files.
3. Work through tasks one at a time, updating `.agents/STATE.md` as you go.
4. End with `/simplify` quality gate + smoke tests.

If you're adding a new feature, look at `.agents/sprints/` for the established pattern. POC sprints 1–7 shipped; sprint 8+ deferred (see [`.agents/STATE.md`](./.agents/STATE.md)).

---

## Documentation map

Where to find what:

| Need                                                  | File                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| **Use the API** as a frontend dev                     | [BACKEND_GUIDE.md](./BACKEND_GUIDE.md)               |
| **Set up the repo + contribute**                      | This file                                            |
| **Understand a design decision**                      | `.agents/decisions/NNNN-*.md` (20+ ADRs)             |
| **Live project state** (which sprint, what's blocked) | [.agents/STATE.md](./.agents/STATE.md)               |
| **Code conventions**                                  | [.agents/CONVENTIONS.md](./.agents/CONVENTIONS.md)   |
| **Data model + folder rules + AI flows**              | [.agents/ARCHITECTURE.md](./.agents/ARCHITECTURE.md) |
| **What's in / out of scope**                          | [.agents/SCOPE.md](./.agents/SCOPE.md)               |
| **Glossary of project-specific terms**                | [.agents/GLOSSARY.md](./.agents/GLOSSARY.md)         |
| **Sprint history + detail files**                     | [.agents/sprints/](./.agents/sprints/)               |

---

## Contributing

This is a POC. Contributions welcome but please:

1. **Open an issue first** for anything beyond a typo fix or trivial change. We've made a lot of explicit "ship small" decisions; non-trivial PRs need a conversation.
2. **Read `.agents/SCOPE.md`** before adding a feature — many things that look like obvious additions are deliberately deferred.
3. **Don't add a dependency** without discussing — every dep we have is justified in an ADR or sprint file.
4. **Don't add tests yet** — tests are deferred per [ADR-0019](./.agents/decisions/0019-deferred-tests.md). When the surface stabilizes we'll add vitest + supertest in one go.
5. **Don't add structured logging yet** — deferred per [ADR-0018](./.agents/decisions/0018-deferred-logging.md).
6. **Don't add OpenAPI spec generation** — deferred per [ADR-0020](./.agents/decisions/0020-deferred-openapi.md). Read this README + the route files.

For any other "should I add X while I'm here" temptation, the default is **no**. Check [`.agents/SCOPE.md`](./.agents/SCOPE.md).

---

## Common operations

### Reset the local database

```bash
docker exec task-list-postgres psql -U postgres -d tasklist -c '
  TRUNCATE "Task", "TaskMedia", "Note", "Alert", "Holiday",
          "DayPlanSubmission", "DayClosureSubmission",
          "VoiceInteraction", "ImageExtraction" CASCADE;
'
npx prisma db seed   # re-create the demo user (idempotent)
```

If you want a clean slate including migrations:

```bash
npx prisma migrate reset   # wipes DB + reruns all migrations + seed
```

### Inspect the database

```bash
npm run db:studio          # Prisma Studio at http://localhost:5555
```

Or directly via psql:

```bash
docker exec -it task-list-postgres psql -U postgres -d tasklist
```

### Update Prisma schema

1. Edit `prisma/schema.prisma`
2. Run `npm run db:migrate` — prompts you for a migration name, generates + applies SQL, regenerates client
3. Commit both the schema change and the new migration folder

### Add a new dependency

1. Discuss in an issue first (see Contributing above)
2. `npm install <pkg>` (or `npm install -D <pkg>` for devDeps)
3. If it's an AI / SDK dependency, **web-research the current API** — our convention says don't trust training data on fast-moving libraries
4. Document the rationale in your commit message (and optionally a new ADR if it's a load-bearing choice)

---

## Troubleshooting

| Symptom                                     | Likely cause                                    | Fix                                                                                   |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Module has no exported member 'Task'`      | Stale Prisma client                             | `npx prisma generate`                                                                 |
| `Module has no exported member 'TaskModel'` | Schema doesn't have that model yet              | Check `prisma/schema.prisma`                                                          |
| `Cannot find module './foo.js'`             | Missing `.js` extension or wrong filename       | NodeNext ESM rule — see Gotcha #7                                                     |
| `prisma migrate dev` hangs                  | Postgres not reachable                          | Check Docker container is up and on port 5432                                         |
| `Invalid environment variables` on startup  | `.env` missing or malformed                     | Compare against `.env.example`; check single-quoting on `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Vertex AI returns 403                       | Service account missing `roles/aiplatform.user` | Grant role in GCP IAM                                                                 |
| Vertex AI returns 404 model not found       | Wrong region for the model                      | `GOOGLE_CLOUD_LOCATION=us-central1` works for `gemini-2.5-flash`                      |
| `/readyz` returns 503                       | DB unreachable                                  | Check Postgres container; `docker ps`                                                 |
| Pre-commit hook fails                       | Lint or format issue on staged files            | `npm run lint:fix && npm run format`, then re-stage                                   |

---

## Status

POC scope (Sprints 1–7) complete. Backend supports the full daily product loop: manual + voice + image task creation, day-plan snapshot, day-closure with structured Hinglish AI feedback. See [`.agents/STATE.md`](./.agents/STATE.md) for the live changelog.

**Sprint 8 (Alerts + History) and Sprint 9 (Polish) are deferred** for the POC. Not needed before client demo.

---

## License

ISC (see [package.json](./package.json)).
