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
docs/       Architecture notes and decisions
```

## Roadmap

1. **Core:** auth, workspaces, Space/Folder/List tree, tasks, statuses
2. **Views:** view engine with List, Board (drag-and-drop), Calendar, Table
3. **Fields and logic:** custom fields, dependencies, automations, service accounts, API keys, MCP server
4. **Planning:** Gantt, workload, time tracking
5. **Knowledge:** docs, dashboards, notifications

Gate 1 (after phase 2): deployed demo with seed data. Gate 2 (after phase 3): an AI agent can create, update and delete a ticket through MCP.

## Getting started

Setup instructions will land with phase 1 (Docker Compose for PostgreSQL, Redis, RabbitMQ and MinIO).
