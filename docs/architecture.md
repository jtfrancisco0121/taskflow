# Architecture notes

## Shape

One Spring Boot application with strict module boundaries (modular monolith), plus background workers (same codebase, worker profile) behind RabbitMQ. The React app talks only to the API over REST and WebSocket (STOMP).

Modules: identity and access, workspaces and locations, tasks and comments, views and query, statuses and fields, docs, automations, time tracking, realtime gateway.

## Key decisions

- **Hierarchy:** one self-referencing `location` table (SPACE, FOLDER, LIST) with a Postgres `ltree` path, so a view scoped to a Space is one indexed query.
- **Views:** a view is a saved query (scope, filters, grouping, sort, type) stored as JSON. One query engine, several renderers.
- **Ordering:** fractional-index rank per task, so a drag updates one row.
- **Custom fields:** definitions are relational and inherited down the tree. Values live in a JSONB column on the task.
- **Events:** outbox table written in the same transaction as the change, relayed to RabbitMQ and Redis pub/sub. Consumers are idempotent.
- **Agent access:** service accounts own API keys with full workspace access (like a ClickUp API key, but not tied to a person). Keys are hashed, prefixed `tf_sk_`, rotatable, revocable and audited. The REST API accepts `Authorization: Bearer <key>` or the raw key. REST and MCP calls share one per-minute rate limit per key, with ClickUp-style `X-RateLimit-*` headers and 429 responses.
