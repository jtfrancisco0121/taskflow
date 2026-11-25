# Taskflow

A ClickUp-style work management app. One set of tasks, many views (List, Board, Table, Calendar, and later Gantt), with statuses and custom fields (twelve types: text, long text, number, date, dropdown, labels, checkbox, URL, email, people, rating, progress) inherited down a Workspace > Space > Folder > List tree. Admins can create service accounts with API keys, and an MCP server lets AI agents view, create, update and delete tickets.

## Stack

- **Frontend:** React, TypeScript, TanStack Query, Zustand, dnd-kit, Tiptap
- **Backend:** Spring Boot 3, Spring Security, Spring Data JPA, jOOQ, Flyway
- **Data and infra:** PostgreSQL (ltree, JSONB), Redis, RabbitMQ, S3-compatible storage (MinIO), Docker Compose

## Repository layout

```
backend/    Spring Boot modular monolith (API and workers)
frontend/   React single-page app
deploy/     Docker Compose for local infrastructure
scripts/    Demo data seed (scripts/seed)
load/       k6 load scripts (load/k6)
docs/       PRD, architecture, decisions (docs/decisions) and the API contract (docs/api/openapi.json)
```

## Docs

- [Product requirements](docs/PRD.md)
- [Architecture](docs/architecture.md)
- [Guidance for AI agents](AGENTS.md)

## Roadmap

1. **Core:** auth, workspaces, Space/Folder/List tree, tasks, statuses
2. **Views:** view engine with List, Board (drag-and-drop), Calendar, Table
3. **Fields and logic:** custom fields, dependencies, automations, service accounts, API keys, MCP server
4. **Planning:** Gantt, workload, time tracking
5. **Knowledge:** docs, dashboards, notifications

Gate 1 (after phase 2): deployed demo with seed data. Gate 2 (after phase 3): an AI agent can create, update and delete a ticket through MCP.

## Getting started

Prerequisites: Docker, Java 21, Node 26 (see `frontend/.nvmrc`).

The defaults need no `.env`. To change one, run `cp .env.example .env` and edit it. A root `.env` reaches each part differently:

- Compose: pass it with `--env-file .env` (Compose's project directory is `deploy/`, so it does not find the root file on its own).
- Backend and Vite: they do not read `.env`. Export it in the shell first: `set -a; . ./.env; set +a`.
- Postgres applies `POSTGRES_*` only on first init. After changing database credentials run `docker compose -f deploy/compose.yaml down -v` before starting again.

```bash
# 1. Infrastructure (add --env-file .env when you have a root .env)
docker compose -f deploy/compose.yaml up -d --wait

# 2. Backend (http://localhost:8080). The `dev` profile supplies a development-only JWT secret.
cd backend && SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend && npm ci && npm run dev
```

Open http://localhost:5173, create an account (Sign up), then a Workspace, a Space and a List, and add tasks from the List view. The Task panel is at `/t/<task id>`, and a Space or List menu in the sidebar opens statuses, rename, privacy and move.

### Frontend tests

```bash
cd frontend
npm test                # Vitest + Testing Library: component tests, HTTP stubbed through the generated client
npm run lint && npm run typecheck
npm run test:e2e        # Playwright (Chromium): needs the infrastructure and the backend running, see below
```

The e2e suite (`e2e/phase1.spec.ts`, `board-dnd.spec.ts` for the Board drag and drop, `realtime.spec.ts` for two browsers and two users) sets itself up: it needs the Mailpit HTTP API for the invite mail (`E2E_MAILPIT_URL`, default `http://localhost:8025`). To run it next to other local services on the usual ports, start Postgres, Redis and Mailpit on other ports, start the backend with `TASKFLOW_DB_URL`, `TASKFLOW_REDIS_PORT`, `TASKFLOW_MAIL_PORT` and `TASKFLOW_PORT` pointing at them, and run `VITE_API_PROXY_TARGET=http://localhost:<port> E2E_MAILPIT_URL=http://localhost:<port> npm run test:e2e`.

The Playwright flows sign up a unique account per run and drive the real backend through the Vite `/api` and `/ws` proxy. Start the infrastructure and the backend as in steps 1 and 2 above (the backend with `SPRING_PROFILES_ACTIVE=dev`), install the browser once with `npx playwright install chromium`, then run `npm run test:e2e` (it starts Vite itself, or reuses one on :5173). CI runs the same flows in the `e2e` job. The refresh cookie is `Secure`; Chromium and Firefox accept it on `http://localhost`, Safari may not, so session restore after a reload can fail there in development.

### Slice reports (UI overhaul evidence)

Every Phase 3.5 slice report carries screenshots in both themes and a bundle-size delta:

- `bash scripts/e2e-local.sh e2e/theme-screens.spec.ts` signs up, seeds a small List and writes `<screen>-light.png` and `<screen>-dark.png` (List, task panel, Board, Table, Calendar, automations, inbox, service accounts) to `artifacts/screenshots/`. The theme is set with an init script and an emulated color scheme; once the app has a theme store, the spec must seed its storage key instead. Since slice 2 the spec also scans every screen with axe's `color-contrast` rule (`frontend/e2e/a11y.ts`) and fails on any request to Google Fonts.
- `bash scripts/bundle-size.sh` builds the frontend and prints the size of `dist/assets` for the branch and for its merge-base with `main`, with the delta as one Markdown line for the PR body: JS/CSS (gzip -9) and self-hosted fonts (raw `.woff2`/`.woff`) are reported separately. It builds the base in a temporary git worktree (`npm ci` needs the network, a few minutes) and removes it again.
- `bash scripts/bundle-size.sh --check` (after `npm run build`, from the repo root) measures the current `frontend/dist/assets` and exits 1 when the JS/CSS size is above the cap in `frontend/bundle-budget.json` (slice-1 baseline 388.1 KiB + 15% = 446.3 KiB). `--self-test` proves the check fails with a lowered baseline. CI runs both after the build.
- `npm run check:dist` (in `frontend/`, after `npm run build`) fails when `dist/` is missing, holds the DEV-only `/design` page or points at Google Fonts; `npm run check:dist -- --self-test` proves it fails on a `dist/` with the marker. `npm run dev` serves the design system at `/design` (development only) with a Light / Aurora / System toggle.
- Tests choose, read and list select-like controls only through `frontend/e2e/ui.ts` (Playwright) and `frontend/src/test/ui.ts` (Vitest), always by visible label, so a native select can later become a Radix control without touching the tests. ESLint rejects `selectOption`, `option:checked`, `selectOptions`, `toHaveDisplayValue` and `as HTMLSelectElement` in specs and tests.

### Demo data

`node scripts/seed/demo.mjs` (Node 26, no packages) fills a "Demo" Workspace through the public REST API: three Spaces with Folders and Lists, three invited members (their invite mail is read from Mailpit), a few hundred tasks with statuses, priorities, due dates, assignees, tags, subtasks and comments, and a separate "Load Test / Load 5000" List of exactly 5,000 tasks for the load test. It prints the sign-in details (`demo-owner@example.com`, password `demo-password-2026`). It is safe to run again: each entity is looked up by its stable name first, so a second run, or a run after an interrupted one, creates only what is missing and prints how many entities it created and how many already existed. `SEED_API_URL` (default `http://localhost:5173`, the Vite proxy; use `http://localhost:8080` to skip it) and `SEED_MAILPIT_URL` (default `http://localhost:8025`) are the only settings. `node --test scripts/seed/demo.test.mjs` tests the data generator.

### Load test

`load/k6/list-5000.js` pages `POST /api/v1/views/query` through the seeded 5,000-task List under a manual and a due-date sort (200 per page), fails when a task repeats or is missing, and runs concurrent `PATCH /tasks/{id}` edits with `If-Match` beside it. The run fails when the view page p95 is 300 ms or more. About a tenth of the tasks are made to wait on another task of the List first (`-e BLOCKED_SHARE`, default 0.1), so the view pages are measured with blocked computed, and a `blocked` scenario pages the `is_true` filter and checks the same exactly-once paging under the same 300 ms p95 threshold (`type:blocked_page`).

```bash
node scripts/seed/demo.mjs
k6 run -e API_URL=http://localhost:8080 load/k6/list-5000.js
```

Latest run (k6 v2.4.0, M-series laptop, backend and Postgres 18 on the same machine, 5 paging VUs with 4 iterations each plus 5 editing VUs for 40 s): 4,000 pages read with no repeated or skipped task; view page p95 21 ms (avg 14 ms, max 52 ms); task edit p95 9 ms; 207 edits answered 409 (a lost race, as designed). Scrolling smoothness of the List in a browser (no long task over 100 ms) is not measured by this script: check it in a Chrome performance trace.

### Backend settings

Every setting has a default in `backend/src/main/resources/application.yml`, except the JWT secret, which has none outside the `dev` profile: the backend refuses to start without `TASKFLOW_JWT_SECRET` (at least 32 bytes, for example `openssl rand -base64 48`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TASKFLOW_JWT_SECRET` | none (dev profile only) | Signs access tokens (HS256) |
| `TASKFLOW_REDIS_HOST`, `TASKFLOW_REDIS_PORT` | `localhost`, `6379` | Rate limiting (sign-in) |
| `TASKFLOW_MAIL_HOST`, `TASKFLOW_MAIL_PORT` | `localhost`, `1025` | SMTP for invite mail (Mailpit in development) |
| `TASKFLOW_APP_URL` | `http://localhost:5173` | Base of the invite links |
| `TASKFLOW_RABBITMQ_HOST`, `_PORT`, `_USER`, `_PASSWORD` | `localhost`, `5672`, `taskflow`, `taskflow` | RabbitMQ for the automation and notification consumers |
| `TASKFLOW_DB_POOL_SIZE` | `20` | Database pool shared by HTTP, both relays, the due sweep and the consumers |
| `taskflow.workers.enabled` | `true` | Runs the RabbitMQ listeners and the due-date sweep (`TASKFLOW_WORKERS_ENABLED`) |
| `taskflow.outbox.amqp.enabled` | `true` | Publishes outbox rows to RabbitMQ (`TASKFLOW_OUTBOX_AMQP_ENABLED`) |

### Agent access (service accounts, API keys, MCP)

An owner or admin creates an agent identity in the app: **Settings** (header) > **Create service account** > **Create key**. The key (`tf_sk_...`) is shown once; copy it into a secret manager. Keys can expire, be revoked on their own, and the whole account can be disabled. The detail page shows the **MCP URL**, calls per day for 30 days, and the account's recent changes (with Restore for deleted tasks). A service account is an admin of its one Workspace and cannot manage service accounts or keys.

Connect an MCP client (streamable HTTP) with only a URL and the key in the `Authorization` header (`Bearer tf_sk_...` or the bare key):

```bash
claude mcp add --transport http taskflow http://localhost:5173/api/v1/mcp --header "Authorization: Bearer tf_sk_..."
```

Tools: `search_tasks` (words, a location, custom field conditions and `blocked`), `get_task` (with `blocked`, `blockerCount` and `dependencies`), `add_dependency` and `remove_dependency` (relate tasks: `WAITING_ON`, `BLOCKING` or `LINKED`, across Lists of the Workspace; a loop is refused with `dependency.cycle`), `create_task`, `update_task`, `move_task`, `delete_task` (30-day trash), `add_comment`, `list_locations`, `list_views`, `list_custom_fields`, and the automation and inbox tools below. `create_task` and `update_task` take `customFields` (`{field id or name: value}`, Dropdown and Labels by Option name); `list_custom_fields(locationId)` shows what a location offers. The same key works on REST (`curl -H "Authorization: Bearer tf_sk_..." http://localhost:8080/api/v1/workspaces`). Each key has a per-minute budget shared by REST and MCP (default 100, `taskflow.api-keys.rate-limit.plans.default`): responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`, and the call over the limit answers 429 with `Retry-After`. `create_task`, `update_task`, `add_comment` and `add_dependency` take an optional `idempotencyKey` argument: send a new UUID per call and reuse it only to retry, so a retry returns the first result instead of repeating the change (the same key with other arguments fails with `idempotency.key_reused`). Every change an agent makes is attributed to the service account and the key. See [decision 005](docs/decisions/005-agent-access.md).

Automation and inbox tools (Phase 3C, [decision 009](docs/decisions/009-automations-notifications.md)):

- `list_automations(locationId)`: the rules a Space, Folder or List defines and inherits, with `id`, `version`, `enabled`, `definedAt` and the last run.
- `create_automation(locationId, name, trigger, actions, conditions?, enabled?, idempotencyKey?)`: a rule. `trigger` is `{type, ...}` with type `TASK_CREATED`, `STATUS_CHANGED` (`fromStatuses`, `toStatuses` by status name), `ASSIGNEE_CHANGED` (`personId`), `CUSTOM_FIELD_CHANGED` (`fieldId`), `DUE_DATE_APPROACHING` or `DUE_DATE_ARRIVED`; `conditions` and `actions` are lists of `{type, ...}` as in the REST API (`POST /api/v1/locations/{id}/automations`). A retry with the same `idempotencyKey` returns the first rule. A bad rule fails with `automation.invalid_trigger`, `automation.invalid_condition`, `automation.invalid_action` or `automation.limit`.
- `toggle_automation(automationId, enabled)`: switch a rule on or off.
- `list_notifications(unread?, cursor?, limit?)` and `mark_notification_read(notificationId)`: the inbox of the person who created the service account, in its Workspace. A service account with no owner, or whose owner left the Workspace, gets `notification.no_owner` and nothing changes.

Rule changes an agent makes are attributed to the service account and the key like any other.

### Automations and notifications (Phase 3C)

Rules (`/w/<workspace>/l/<location>/automations`) run in the API process from RabbitMQ; notifications reach the bell and `/w/<workspace>/inbox` live. Open the RabbitMQ management UI at <http://localhost:15672> (user and password `taskflow`) and look at the queues `taskflow.automation.dlq` and `taskflow.notification.dlq`: a message there failed three times and the rule run shows as Failed in its run history. The migrations of this phase use the window `V202612030000`-`V202612032359` ([decision 009](docs/decisions/009-automations-notifications.md)).

Rollback note: before returning to an older build, drain the outbox first (let the relays catch up). Unpublished `notification.*` and `automation.*` rows would otherwise reach the old `EventRouter` default and go to the Workspace topic (ids only, no text).

### Authentication

`POST /api/v1/auth/signup` and `/signin` return a 15-minute access token in the body (send it as `Authorization: Bearer ...`) and set an HttpOnly, Secure, SameSite=Strict refresh cookie scoped to `/api/v1/auth`. `POST /api/v1/auth/refresh` rotates both; presenting an old refresh token revokes the whole session. Every other `/api/v1/**` endpoint needs the access token, except `GET /api/v1/meta` and `GET /api/v1/invites/{token}`. Roles are resolved per request, not stored in the token. Sign-in is rate limited per client IP; behind a reverse proxy, list the proxy's IP addresses in `TASKFLOW_TRUSTED_PROXIES` so the limit sees the real client from `X-Forwarded-For` (no proxy is trusted by default, see decision 005 item 14).

Conventions for clients: errors are `application/problem+json` with a dotted `code`; a resource you cannot see answers 404, never 403; `PATCH`, move, delete and restore on a task need `If-Match` with the task's `ETag` (a stale one answers 409 with the current task); create endpoints accept an `Idempotency-Key` header; lists page with an opaque `cursor`. See [decision 002](docs/decisions/002-phase1-core-backend.md).

| What | URL |
| --- | --- |
| App | http://localhost:5173 |
| API | http://localhost:8080 |
| Swagger UI | http://localhost:8080/swagger-ui.html |
| RabbitMQ management | http://localhost:15672 |
| Object storage console | http://localhost:9001 |
| Mailpit inbox | http://localhost:8025 |

All Compose ports bind to `127.0.0.1` (set `HOST_BIND` to change that).

### Tests and lint

```bash
cd backend && ./mvnw verify                      # unit tests, integration tests (needs Docker), format check
cd frontend && npm run lint && npm run typecheck && npm test
```

### Secret scan and local e2e

```bash
bash scripts/secret-scan.sh              # gitleaks over the full git history (binary on PATH, else a pinned Docker image); config in .gitleaks.toml
bash scripts/secret-scan.sh --self-test  # proves a newly committed secret makes the scan fail (throwaway repo inside the container)
bash scripts/e2e-local.sh                # compose up, reuse or start the backend (dev profile), run Playwright, stop what it started
```

CI runs the scan in the `secrets` job. `scripts/e2e-local.sh` is the local equivalent of the `e2e` job and writes the Playwright screenshots of the new screens to the git-ignored `artifacts/screenshots/` (`E2E_SCREENSHOTS_DIR`; set it to `docs/screenshots` only when you mean to update the committed images; specs call `snap()` from `frontend/e2e/screenshots.ts`). It needs the default Compose ports free (Postgres 5432, Redis 6379, ...).

### API contract

`docs/api/openapi.json` is the contract the frontend generates its client from. After changing the API:

```bash
cd backend && ./mvnw verify -Dopenapi.update=true   # rewrites docs/api/openapi.json
cd frontend && npm run gen:api                      # regenerates src/api/schema.d.ts
```

Commit both files. CI fails when either is stale.
