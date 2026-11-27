# Taskflow

A ClickUp-style work management app: one set of tasks, seen as a List, Board, Table or Calendar.

Tasks live in a **Workspace > Space > Folder > List** tree. Statuses and custom fields are set once on a location and
inherited by everything below it. Admins can create service accounts with API keys, and an MCP server lets AI agents
search, create, update and delete tasks.

## Features

- **Views:** List, Board (drag and drop), Table and Calendar over the same tasks, with filter, sort and group.
- **Custom fields:** 12 types (text, long text, number, date, dropdown, labels, checkbox, URL, email, people, rating,
  progress), inherited down the tree.
- **Task dependencies:** "waiting on", "blocking" and "linked to", with loop detection and a derived "blocked" flag.
- **Automations and notifications:** rules per location (trigger, conditions, actions) and a live in-app inbox.
- **Real time:** changes show up live in every open browser.
- **Agent access:** service accounts, API keys and an MCP server (`/api/v1/mcp`).
- **Light and dark themes**, and a command palette on Cmd+K / Ctrl+K.

## Quick start

You need Docker, Java 21 and Node 26 (see `frontend/.nvmrc`). The defaults need no `.env`.

```bash
# Run every step from the repository root, each in its own terminal where noted.

# 1. Infrastructure: Postgres, Redis, RabbitMQ, MinIO, Mailpit
docker compose -f deploy/compose.yaml up -d --wait

# 2. Backend on http://localhost:8080 (the dev profile supplies a development-only JWT secret)
(cd backend && SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run)

# 3. Frontend on http://localhost:5173, in a second terminal
(cd frontend && npm ci && npm run dev)

# 4. Optional demo data, in a third terminal (needs Mailpit from step 1)
node scripts/seed/demo.mjs
```

Open <http://localhost:5173>. Sign up and create a Workspace, a Space and a List, or sign in to the seeded demo with
`demo-owner@example.com` / `demo-password-2026`. To start over, run
`docker compose -f deploy/compose.yaml down -v`.

| What                   | URL                                                |
| ---------------------- | -------------------------------------------------- |
| App                    | <http://localhost:5173>                            |
| API                    | <http://localhost:8080>                            |
| Swagger UI             | <http://localhost:8080/swagger-ui.html>            |
| Mailpit inbox          | <http://localhost:8025>                            |
| RabbitMQ management    | <http://localhost:15672> (`taskflow` / `taskflow`) |
| Object storage console | <http://localhost:9001>                            |

Compose ports bind to `127.0.0.1` (set `HOST_BIND` to change that). To change a setting, run
`cp .env.example .env`, edit it, and see [Configuration](#configuration).

## Running the checks

GitHub Actions CI (`.github/workflows/ci.yml`) is currently disabled, so the local checks are the gate. Run them from
the repository root; the backend tests need Docker running.

```bash
(cd backend && ./mvnw verify)            # unit and integration tests, format check, API contract check
cd frontend
npm ci
npm run gen:api && git diff --exit-code -- src/api/schema.d.ts   # generated client is current
npm run lint && npm run typecheck && npm test
npm run build && npm run check:dist
cd .. && bash scripts/bundle-size.sh --check                     # JS/CSS size budget
bash scripts/secret-scan.sh                                      # gitleaks over the git history
bash scripts/e2e-local.sh                                        # Playwright against the real stack
```

Notes:

- `scripts/e2e-local.sh` starts Compose and the backend if they are not running, then stops what it started. It needs
  the default Compose ports free. Pass a spec path to run one file, for example `bash scripts/e2e-local.sh e2e/list.spec.ts`.
- `bash scripts/secret-scan.sh` uses a `gitleaks` binary on your `PATH`, otherwise a pinned Docker image.
- The load test (`k6 run -e API_URL=http://localhost:8080 load/k6/list-5000.js`) needs the seeded demo data and k6.

## Configuration

Every setting has a default in `backend/src/main/resources/application.yml`, except the JWT secret outside the `dev`
profile: the backend refuses to start without `TASKFLOW_JWT_SECRET` (at least 32 bytes, for example
`openssl rand -base64 48`). Common settings:

| Variable                                                | Default                                     | Purpose                               |
| ------------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `TASKFLOW_JWT_SECRET`                                   | none (dev profile only)                     | Signs access tokens                   |
| `TASKFLOW_APP_URL`                                      | `http://localhost:5173`                     | Base of invite links                  |
| `TASKFLOW_REDIS_HOST`, `TASKFLOW_REDIS_PORT`            | `localhost`, `6379`                         | Sign-in rate limiting                 |
| `TASKFLOW_MAIL_HOST`, `TASKFLOW_MAIL_PORT`              | `localhost`, `1025`                         | SMTP for invite mail                  |
| `TASKFLOW_RABBITMQ_HOST`, `_PORT`, `_USER`, `_PASSWORD` | `localhost`, `5672`, `taskflow`, `taskflow` | Automation and notification consumers |
| `TASKFLOW_DB_POOL_SIZE`                                 | `20`                                        | Shared database pool                  |

A root `.env` is read by neither the backend nor Vite: export it first with `set -a; . ./.env; set +a`. Pass it to
Compose with `--env-file .env`. Postgres applies `POSTGRES_*` only on first init, so run
`docker compose -f deploy/compose.yaml down -v` after changing database credentials.

## Agent access (MCP)

An owner or admin opens **Settings > Create service account > Create key**. The key (`tf_sk_...`) is shown once.
Connect an MCP client over streamable HTTP with the URL and the key:

```bash
claude mcp add --transport http taskflow http://localhost:5173/api/v1/mcp --header "Authorization: Bearer tf_sk_..."
```

The same key works on the REST API. Tool list, rate limits and idempotency keys: see
[decision 005](docs/decisions/005-agent-access.md) and, for automations and the inbox,
[decision 009](docs/decisions/009-automations-notifications.md).

## Project layout

| Path        | What                                                               |
| ----------- | ------------------------------------------------------------------ |
| `backend/`  | Spring Boot modular monolith (API and workers)                     |
| `frontend/` | React single-page app, with Vitest and Playwright tests            |
| `deploy/`   | Docker Compose for local infrastructure                            |
| `scripts/`  | Demo data seed, secret scan, local e2e runner, bundle-size check   |
| `load/k6/`  | k6 load test for a 5,000-task List                                 |
| `docs/`     | PRD, architecture, decisions, UI slices, screenshots, API contract |

The API contract is `docs/api/openapi.json`, and the frontend generates its client from it. After changing the API, run
`cd backend && ./mvnw verify -Dopenapi.update=true` and `cd frontend && npm run gen:api`, and commit both files.

## Tech stack

| Layer    | Technology                                                                  |
| -------- | --------------------------------------------------------------------------- |
| Frontend | React, TypeScript, Vite, TanStack Query, Zustand, dnd-kit, Tiptap, Tailwind |
| Backend  | Java 21, Spring Boot 3.5, Spring Security, Spring Data JPA, jOOQ, Flyway    |
| Data     | PostgreSQL 18 (ltree, JSONB), Redis, RabbitMQ, MinIO (S3-compatible)        |
| Tooling  | Docker Compose, Maven, Vitest, Playwright, k6                               |

## Docs

- [Product requirements](docs/PRD.md) and [architecture](docs/architecture.md)
- [Decision records](docs/decisions)
- [UI requirements](docs/ui/UI-PRD.md)
- [Guidance for AI agents](AGENTS.md)

## Status

| Phase | Scope                                                                                            | State       |
| ----- | ------------------------------------------------------------------------------------------------ | ----------- |
| 1     | Auth, Workspaces, Space/Folder/List tree, tasks, statuses                                        | Done        |
| 2     | View engine: List, Board, Table, Calendar; real time                                             | Done        |
| 3     | Custom fields, dependencies, automations, notifications, service accounts, API keys, MCP         | Done        |
| 3.5   | UI overhaul: design system, light and dark themes, restyled screens (slices in `docs/ui/slices`) | In progress |
| 4     | Gantt, workload, time tracking                                                                   | Not started |
| 5     | Docs, dashboards, forms                                                                          | Not started |

Details and open questions are in the [PRD](docs/PRD.md).
