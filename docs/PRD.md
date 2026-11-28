# Taskflow: Product Requirements Document

Status: Draft v1 · Owner: JT Francisco · Date: 2026-11-24

## 1. Summary

Taskflow is a ClickUp-style work management web app. Teams organize work in a Workspace > Space > Folder > List tree, manage tasks with statuses and custom fields, and look at the same tasks through different views (List, Board, Table, Calendar, later Gantt). Admins can create service accounts with API keys, and an MCP server lets AI agents view, create, update and delete tickets with full access.

The project is built as a portfolio showcase on React and Java Spring Boot. It should look and behave close enough to ClickUp to feel familiar, while being scoped so one developer (with AI agents) can ship a polished version.

## 2. Goals

1. Deliver the core of ClickUp's model: a hierarchy, tasks, inherited statuses and custom fields, and a view engine that renders one query several ways.
2. Make AI agents first-class users: a service account with an API key and an MCP endpoint, so an agent can work on tickets without borrowing a person's login.
3. Show engineering depth a reviewer can check: real-time sync, optimistic UI, event-driven backend, tests, CI/CD and a live demo.
4. Keep every phase shippable. Phases 1 and 2 alone are a credible portfolio project.

## 3. Non-goals (for now)

- Chat, whiteboards, goals and OKRs, AI-generated fields, native mobile apps.
- OAuth for third-party apps, SSO, billing and plans.
- Importing from ClickUp or other tools.
- Public sharing of Lists or Docs.
- Offline mode.

## 4. Users

| User | Who they are | What they need |
| --- | --- | --- |
| Workspace owner / admin | Sets up the Workspace, invites people, manages service accounts | Structure the hierarchy, control access, see what agents did |
| Member | Day-to-day user | Create and update tasks fast, switch views, collaborate |
| Guest | Limited collaborator | See and comment on the Spaces they are invited to |
| AI agent | A service account acting through the API or MCP | Full, reliable access to tickets through stable tools |
| Reviewer | A recruiter or engineer looking at the demo | A seeded, deployed app that explains itself in minutes |

## 5. Product principles

1. **One dataset, many views.** Views are saved queries over tasks, never separate data.
2. **Inherit by default.** Statuses and custom fields are set at a location and flow down. A lower level can override.
3. **Fast on big lists.** A List with 5,000 tasks stays responsive.
4. **Humans and agents share one front door.** The UI, scripts and agents use the same API and permission checks.
5. **Everything is attributable.** Each change records who or what made it.

## 6. Glossary

- **Workspace:** the top-level container for a company or team.
- **Space:** a department, team or large initiative. Has its own settings and access.
- **Folder:** optional grouping inside a Space. Creating a Folder creates a first List in it.
- **List:** a container of tasks. A task has exactly one home List.
- **Task:** the unit of work. Can have subtasks, checklists, assignees, dates, tags, custom fields.
- **Status:** a workflow stage, defined per location and grouped (not started, active, done, closed).
- **View:** a saved configuration (type, scope, filters, grouping, sort, columns).
- **Custom field:** a typed field defined at a location and available on every task below it.
- **Service account:** a non-human, workspace-level identity with full access, owned by an admin.
- **API key:** a secret credential belonging to a service account.

## 7. Functional requirements

Requirement IDs are stable. Agents and tests should reference them.

### Phase 1: Core

**AUTH: Accounts and access**

- AUTH-1: Users sign up, sign in and sign out with email and password. Passwords are hashed with Argon2 or bcrypt.
- AUTH-2: Access tokens are short-lived with refresh-token rotation. Sign-in is rate limited.
- AUTH-3: Roles per Workspace: owner, admin, member, guest.
- AUTH-4: Admins invite people by email link. In development, emails go to a local mail catcher.
- Acceptance: a new user can sign up, create a Workspace, invite a second user, and that user can join and see only what their role allows.

**WS and LOC: Workspaces and hierarchy**

- WS-1: A user can belong to several Workspaces and switch between them.
- LOC-1: Create, rename, reorder, move, archive and delete Spaces, Folders and Lists.
- LOC-2: A Folder is optional. Creating a Folder creates a first List inside it.
- LOC-3: Spaces can be private. Private Spaces, Folders and Lists are visible only to members who have a grant.
- LOC-4: The sidebar shows the tree, loads children lazily, and remembers expansion state.
- Acceptance: a task list under a nested location appears when a view is scoped to any ancestor of that location.

**TASK: Tasks**

- TASK-1: Create and edit a task with title, rich-text description, status, priority (urgent, high, normal, low, none), start and due dates, tags and multiple assignees.
- TASK-2: Subtasks nest to any depth. Tasks have checklists with items.
- TASK-3: Move or duplicate a task to another List.
- TASK-4: Delete moves a task to a trash for 30 days, with restore.
- TASK-5: Each task has a readable id (for example `TF-123`) and a deep link (`/t/:taskId`) that opens the detail panel over any view.
- TASK-6: Optimistic locking. A stale edit returns HTTP 409 with the current task.
- Acceptance: two users editing the same task never silently overwrite each other.

**STAT: Statuses**

- STAT-1: Statuses are defined per Space, Folder or List, each mapped to a group. A location inherits from the nearest ancestor that defines its own.
- STAT-2: A default status set exists for new Spaces.
- Acceptance: changing a Space's statuses updates every inheriting List without touching Lists that override.

**CMT: Comments and activity**

- CMT-1: Comments with rich text and @mentions. Edit and delete own comments.
- CMT-2: A per-task activity log of every change, showing the actor (person, service account, or automation).

### Phase 2: Views

**VIEW: View engine**

- VIEW-1: A view has a type, a scope (Workspace, Space, Folder or List), filters with AND/OR groups, grouping, sort and visible columns.
- VIEW-2: Views are personal, shared or private. Every location gets List and Board views by default.
- VIEW-3: View filters, grouping and sort are in the URL so a view can be shared by link.
- VIEW-4: Tasks load with keyset pagination, never offset.
- Acceptance: a Space-scoped view returns the same tasks as the union of its Lists, and pages through 5,000 tasks without duplicates or gaps.

**List, Board, Table, Calendar**

- LIST-1: Grouped, virtualized List view with inline edit and bulk actions (status, assignee, priority, move, delete).
- BOARD-1: Board view with columns by status (or another field). Drag a card to reorder or change column. The server computes the new rank.
- BOARD-2: Dragging is optimistic and rolls back on error or a 409.
- TABLE-1: Table view with resizable, reorderable columns and inline editors by field type.
- CAL-1: Calendar view (month and week) shows tasks by due date. Drag to reschedule.

**RT: Real-time and search**

- RT-1: Task and location changes appear live in other users' open views (WebSocket, STOMP).
- RT-2: Presence on a task ("Anna is viewing this").
- RT-3: A client ignores the echo of its own change and ignores stale events using the task version.
- SEARCH-1: Global search over task titles and descriptions (PostgreSQL full-text search).

### Phase 3: Fields, logic and agent access

**FIELD: Custom fields**

- FIELD-1: Types: text, long text, number, dropdown, labels, date, checkbox, URL, email, people, rating, progress. Formula fields come later. Status: done (3A).
- FIELD-2: A field defined at a location applies to every task below it. Definitions are inherited. A lower location can hide an inherited field but not redefine its type. Status: done (3A).
- FIELD-3: Filter, sort, group and show fields in views. Status: done (3A).

**DEP: Dependencies**

- DEP-1: Two tasks of one Workspace, in any Lists, can be related as a dependency (one task "waits on" or is "blocked by" the other, and the other is "blocking" it) or as a plain link ("linked to"). One relationship exists per pair of tasks. A task holds at most 100. The same task, a task in another Workspace, a trashed task and a second relationship between the same pair are refused. Status: done (3B).
  - Acceptance: REST create, list and delete work across Lists; adding or removing sends `If-Match` with the acting task's version and bumps the version of both tasks; refusals use `dependency.self` (400), `task.not_found` (404), `dependency.exists`, `dependency.limit`, `dependency.cycle` (409); lock contention is `request.busy` (503 with `Retry-After`, as on every endpoint). Tests: `DependencyIT`, `DependencyPermissionsIT`.
- DEP-2: Creating a dependency that would close a loop (A waits on B, B on C, C on A) is rejected with 409 `dependency.cycle` and the path of task ids (a task the caller cannot see is `null`). Links are not checked. Two concurrent adds that together would close a loop cannot both succeed. Trashing a task never lets a restore create a loop. Status: done (3B).
  - Acceptance: the A -> B -> C -> A case returns the path and writes no row, event or version bump; a loop through a trashed task is refused; a concurrent test lets exactly one of two closing adds succeed. Tests: `DependencyCycleIT`.
- DEP-3: Deleting, trashing or purging a task leaves no dangling relationship. A trashed task's relationships disappear from both tasks' lists and stop counting, and come back unchanged on restore; purging deletes the rows. Status: done (3B).
  - Acceptance: tests show the relationship leaves both lists on trash, returns on restore with no write, and is gone from the table after purge. Tests: `DependencyIT`.
- DEP-4: A task is blocked while a task it waits on is unfinished (not trashed, List not deleted, status group NOT_STARTED or ACTIVE). Blocked is derived, never stored, and shows everywhere: `blocked` and `blockerCount` on every task read and search hit, a Blocked badge on List rows, Board cards, Table title cells, Calendar chips and the task panel header, and an "is blocked" / "is not blocked" view filter kept in the URL. Moving a blocked task to DONE or CLOSED warns ("Complete anyway" or "Cancel") and never hard-blocks: the API returns 200 and the activity entry carries `completedWhileBlocked`. A blocker the caller cannot see still counts. Status: done (3B).
  - Acceptance: blocked flips as the blocker is completed, reopened, trashed and restored; task get, list, view query, workspace search and MCP search agree; the filter returns exactly the blocked tasks across pages. Tests: `BlockedStateIT`, the Vitest suites of `features/dependencies` and `features/views`, `frontend/e2e/dependencies.spec.ts`.
- DEP-5: When a blocker crosses the finished boundary (a status change, a move, a status-set remap or an edit of a status group, trash or restore) each live dependent gets `task.blocker_resolved` or `task.blocker_reopened` in the same transaction, once, without a version bump. Notification delivery belongs to NOTIF-1; consumers dedupe on the outbox id. Relationship changes are permission-checked (Task edit on the acting task, view on the other), attributed to the person or the service account and key, and broadcast over STOMP with ids only. Status: done (3B).
  - Acceptance: one outbox row and one activity row per dependent for each caller; a change that does not cross the boundary records none. Tests: `BlockerEventsIT`, `EventPayloadContractIT`, `DependencyRealtimeIT`.
- DEP-6: Agents manage relationships over MCP: `add_dependency`, `remove_dependency`, `get_task` with `blocked`, `blockerCount` and `dependencies`, and `search_tasks` with `blocked`. They share the REST service methods, so permissions, cycle checks and errors are the same. Status: done (3B).
  - Acceptance: an MCP-level test with an API key calls all four, replays an `add_dependency` with the same `idempotencyKey` and is attributed to the key. Tests: `McpDependenciesIT`.

**AUTO: Automations v1**

- AUTO-1: A rule has a trigger (task created, status changed, assignee changed, custom field changed, due date approaching or arriving), optional conditions, and actions (change status, assign, set priority, add comment, set due date, create subtask, send notification). Status: done (3C).
- AUTO-2: Rules are set on a location and apply to tasks below it. A rule acts only on tasks its creator can view. Status: done (3C).
- AUTO-3: A rule cannot trigger itself in a loop. Each event carries the id of the automation that caused it, a depth limit of 3 stops chains, a rule never runs on its own change, and at most 10 runs per rule and task in 10 minutes. Actions are attributed in the activity feed ("by automation <name>"), failed runs go to the dead-letter queue and show in the run history. Status: done (3C).
- AUTO-4: Time-based triggers run from a scheduler that is safe across several instances (a unique signal table, no ShedLock: decision 009). Status: done (3C).

**NOTIF: Notifications**

- NOTIF-1: In-app notifications for assignments, mentions, comments and status changes on watched tasks, due dates, resolved blockers and rule messages, with an unread count that updates live over STOMP and per-user preferences. Never for service accounts. Email is the digest hook only: nothing is sent. Status: done (3C).

**SA, KEY and MCP: Agent access** (details in section 8)

### Phase 4: Planning

- GANTT-1: Gantt view with task bars, dependencies and drag-to-reschedule.
- TL-1: Timeline view grouped by assignee or List.
- WL-1: Workload view showing assigned hours against capacity.
- TIME-1: Timer and manual time entries on tasks, estimates, billable flag, and a timesheet report.
- SPR-1 (optional): Sprint Folders with start and end dates and a burndown chart.

### Phase 5: Knowledge and reporting

- DOC-1: Docs with nested pages, rich text, and embedded task links.
- DASH-1: Dashboards with a handful of widgets (task counts by status, tasks per assignee, time tracked, overdue tasks).
- FORM-1: Forms that create tasks in a List.
- DIGEST-1: Daily email digest.

## 8. Service accounts, API keys and MCP

This is modelled on ClickUp's personal API key, which carries its owner's full access, but attached to a non-human service account.

### 8.1 Service accounts

- SA-1: An admin creates a service account in a Workspace (for example `triage-agent`). It has no password and no email, and does not use a seat.
- SA-2: A service account has full access to the Workspace, the same as an admin.
- SA-3: An admin can disable a service account, which cuts off all its keys at once.
- SA-4: Every change made by a service account is logged with the service account and the key as the actor.

### 8.2 API keys

- KEY-1: A service account can hold several keys. A key is shown once, at creation, and prefixed `tf_sk_` so secret scanners can detect leaks.
- KEY-2: The server stores only a SHA-256 hash, the prefix and the last four characters, plus name, optional expiry, last-used time and a revoked flag.
- KEY-3: A key carries the full access of its service account. There are no per-key scopes.
- KEY-4: Rotation has no downtime: add a new key, switch the agent, revoke the old one.
- KEY-5: The API accepts `Authorization: Bearer <key>` and also the raw key as the header value, so ClickUp-style clients work unchanged.
- KEY-6: Rate limit per key, per minute, with `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers and HTTP 429 when exceeded. Limits are set per Workspace plan. There is no daily cap.
- KEY-7: Admins get an audit view per service account: last used, calls per day, recent changes.

### 8.3 MCP server

- MCP-1: An MCP endpoint (streamable HTTP) inside the API, authenticated by the same API key.
- MCP-2: Tools: `search_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `delete_task`, `add_comment`, `list_locations`, `list_views`, `list_custom_fields`. Each is a thin wrapper over an existing service method; `create_task` and `update_task` take custom field values, and `search_tasks` filters on them.
- MCP-3: REST and MCP calls from a key share one per-minute limit.
- MCP-4: `delete_task` moves a task to the 30-day trash.
- MCP-5 (later): an OAuth flow so an agent can get a key after a user approves a consent screen.
- Acceptance (Gate 2): an agent configured with only an MCP URL and a key can create, update, move, comment on and delete a ticket, and the activity log attributes each action to the service account.

### 8.4 Risk and guardrails

Full access means a hijacked agent can do real damage, so:

- Treat keys as production secrets: keep them in a secret manager, set an expiry, rotate them, revoke at the first sign of a leak.
- Deletes go to a 30-day trash.
- Ticket text is untrusted input. Agents should keep human review of destructive steps in their own tooling.
- The key goes in the agent's MCP configuration or an environment variable, never in a chat prompt.

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | A List of 5,000 tasks scrolls smoothly. A view query over 1,000 tasks returns in under 300 ms at p95 on the demo database. A drag updates one row. |
| Concurrency | Optimistic locking on tasks. Parallel moves and edits on one task are covered by tests. |
| Security | Tenant isolation by `workspace_id` on every table. Passwords hashed. CORS limited to the app origin. Dependency scanning in CI. Secrets never logged. |
| Reliability | Events are written in the same transaction as the change (outbox). Consumers are idempotent. Failed messages go to a dead-letter queue. |
| Accessibility | Keyboard navigation for the sidebar, views and task panel. Basic WCAG AA contrast and labels. |
| Observability | Structured JSON logs with a request id, metrics, health checks. Tracing if time allows. |
| Browsers | Latest Chrome, Safari, Firefox and Edge on desktop. Mobile layout is a stretch goal. |
| Testing | Unit tests for ranking, permissions and the view query compiler. Integration tests on real PostgreSQL, Redis and RabbitMQ. Playwright end-to-end tests for sign-in, Board drag-and-drop, and a two-browser real-time test. |

## 10. Success metrics

These are checks for a portfolio project, not business KPIs.

1. **Gate 1: demo-ready.** Deployed, seeded with a realistic demo Workspace, README with screenshots, CI green.
2. **Gate 2: agent-ready.** The MCP acceptance test in section 8.3 passes against the deployed demo.
3. A k6 load test (5,000-task List plus concurrent edits) with results in the README.
4. A two-browser real-time test and a Board drag-and-drop test running in CI.
5. A short "design decisions" section in the README that explains the choices in `docs/architecture.md`.

## 11. Release plan

Week ranges are rough estimates for one developer. Phases 1 and 2 are about six weeks.

| Phase | Weeks | Scope | Gate |
| --- | --- | --- | --- |
| 1. Core | 1 to 3 | Auth, hierarchy, tasks, statuses, comments | |
| 2. Views | 4 to 6 | View engine, List, Board, Calendar, Table, real-time, search | Gate 1: demo-ready |
| 3. Fields and logic | 7 to 8 | Custom fields, dependencies, automations, notifications, service accounts, API keys, MCP | Gate 2: agent-ready |
| 4. Planning | 9 to 11 | Gantt, Timeline, Workload, time tracking | |
| 5. Knowledge | 12 to 13 | Docs, dashboards, forms, digests | |

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Scope creep, since ClickUp is huge | Freeze phases 1 and 2 first. Keep a "not now" list. A new view or field type ships only with tests. |
| Slow views on large Spaces | `ltree` scoping, indexes, keyset pagination, and a 5,000-task load test during phase 2. |
| Ordering and real-time bugs under concurrent edits | Fractional ranks, optimistic locking, versions in events, and a two-browser test. |
| Duplicate events from the outbox relay | Idempotent consumers and a dead-letter queue. |
| An agent damaging or leaking data | Keys treated as secrets with expiry and rotation, instant revoke or disable, 30-day trash, and an audit view. |

## 13. Open questions

1. Hosting target for the demo (a single VM, Render, Fly.io or Azure)?
2. Email provider for invites and notifications (SMTP relay, Resend, SES)?
3. Rich text storage format: Tiptap JSON (proposed) or Markdown?
4. Should sprints be in phase 4 or cut?
5. One Workspace per demo user, or several?
6. Default per-key rate limit values per plan.

## 14. Reference: what we learned from ClickUp

- Hierarchy: Workspace > Space > Folder > List > Task > Subtask. A Folder is optional and gets a List automatically. A task has one parent List ([ClickUp hierarchy](https://help.clickup.com/hc/en-us/articles/13856392825367-Intro-to-the-Hierarchy), [Lists](https://help.clickup.com/hc/en-us/articles/6308896743575-List-Info)).
- Views can be created at any level and show every task below it. Each Space, Folder and List gets List and Board by default. List view loads up to 5,000 tasks at once ([Intro to views](https://help.clickup.com/hc/en-us/articles/6329880717719), [view limits](https://help.clickup.com/hc/en-us/articles/32274881672599-Views-feature-availability-and-limits)).
- Custom fields added to a location apply to every task in it ([Customizable features](https://help.clickup.com/hc/en-us/articles/9559764679831-Customizable-ClickUp-features)).
- ClickUp personal API tokens begin with `pk_`, are sent as the raw `Authorization` value, never expire, and reach everything the owner can reach ([auth docs](https://developer.clickup.com/docs/authentication), [Iru](https://docs.iru.com/en/compliance/sources/clickup-source), [Nexla](https://docs.nexla.com/user-guides/connectors/click_up_api/click_up_api_auth)).
- The ClickUp API is rate limited per token per minute, with 429 and `X-RateLimit-*` headers ([rate limits](https://developer.clickup.com/docs/rate-limits.md)).
- ClickUp's official MCP server accepts OAuth only, and on free plans has a daily call allowance ([ClickUp MCP help](https://help.clickup.com/hc/en-us/articles/33335772678423-What-is-ClickUp-MCP)). Our design deliberately differs: service-account keys work on REST and MCP, with one per-minute limit.
