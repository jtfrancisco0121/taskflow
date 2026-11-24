# AGENTS.md

Guidance for AI coding agents working in this repository.

## Read first

1. `docs/PRD.md`: what to build. Requirement IDs (for example `TASK-6`, `KEY-3`) are stable. Reference them in commits and tests.
2. `docs/architecture.md`: how to build it. Follow its module boundaries, data model and design decisions. If you must deviate, write down why in `docs/decisions/NNN-title.md` and say so in your summary.

## Project in one paragraph

Taskflow is a ClickUp-style work management app: Workspace > Space > Folder > List > Task, with inherited statuses and custom fields, a view engine (List, Board, Table, Calendar, later Gantt), real-time updates, and service-account API keys plus an MCP server for AI agents. Stack: React + TypeScript (`frontend/`), Java 21 + Spring Boot 3 (`backend/`), PostgreSQL, Redis, RabbitMQ, MinIO.

## Working rules

- Work on the phase you were asked to do. Do not start later phases.
- Build vertically, one requirement at a time: migration, backend, API, frontend, tests.
- Every requirement you implement needs tests. Integration tests use Testcontainers, not mocks of the database.
- Keep modules separate. A module must not import another module's internals. Use its public API or events.
- Database changes go through Flyway migrations only. Never edit an applied migration.
- All writes that change task or location state also write an `outbox_event` and an `activity_event` in the same transaction.
- Event consumers must be idempotent.
- The frontend API client is generated from the backend OpenAPI spec. Do not hand-write request types.
- Never commit secrets. `.env` is ignored. Add new variables to `.env.example`.
- Small, focused commits with clear messages. Do not open pull requests unless asked.
- Before you finish: run the backend tests, the frontend tests and lint, and report what passed and what did not.

## Conventions

- Backend package root: `com.taskflow.<module>`. REST under `/api/v1`. Errors as `application/problem+json`.
- Tasks use optimistic locking (`version`). Updates send `If-Match`. A stale write returns 409 with the current task.
- Lists and views paginate with keyset cursors, never offset.
- Task order uses fractional-index ranks computed on the server.
- API keys: prefix `tf_sk_`, only a SHA-256 hash is stored, shown once, full access of the service account, per-key per-minute rate limit with `X-RateLimit-*` headers.
- Frontend: feature folders under `src/features`, TanStack Query for server state, Zustand for UI state, view filters in the URL.

## Definition of done

- The requirement's acceptance criteria in the PRD are met and covered by a test.
- CI-equivalent checks pass locally (build, tests, lint).
- Docs are updated if behavior or structure changed (`README.md`, `docs/`).
- A short summary lists what changed, how to run it, and anything left open.
