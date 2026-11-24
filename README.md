# Taskflow

A ClickUp-style work management app. One set of tasks, many views (List, Board, Table, Calendar, and later Gantt), with statuses and custom fields inherited down a Workspace > Space > Folder > List tree. Admins can create service accounts with API keys, and an MCP server lets AI agents view, create, update and delete tickets.

## Stack

- **Frontend:** React, TypeScript, TanStack Query, Zustand, dnd-kit, Tiptap
- **Backend:** Spring Boot 3, Spring Security, Spring Data JPA, jOOQ, Flyway
- **Data and infra:** PostgreSQL (ltree, JSONB), Redis, RabbitMQ, S3-compatible storage (MinIO), Docker Compose

## Repository layout

```
backend/    Spring Boot modular monolith (API and workers)
frontend/   React single-page app
deploy/     Docker Compose for local infrastructure
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

# 2. Backend (http://localhost:8080)
cd backend && ./mvnw spring-boot:run

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend && npm ci && npm run dev
```

The home page shows the backend version fetched from `GET /api/v1/meta`.

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

### API contract

`docs/api/openapi.json` is the contract the frontend generates its client from. After changing the API:

```bash
cd backend && ./mvnw verify -Dopenapi.update=true   # rewrites docs/api/openapi.json
cd frontend && npm run gen:api                      # regenerates src/api/schema.d.ts
```

Commit both files. CI fails when either is stale.
