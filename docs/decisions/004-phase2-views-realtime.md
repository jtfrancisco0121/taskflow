# 004: Phase 2 views, real-time and search

Status: accepted. Context: VIEW-1..4, LIST-1, BOARD-1/2, TABLE-1, CAL-1, RT-1..3 and SEARCH-1. It follows
`docs/architecture.md` and the phase 2 architecture spine (AD-1..AD-21) and records where it differs or
adds detail.

## Decisions

1. **One read endpoint for every renderer (AD-5).** `docs/architecture.md` section 9 lists
   `GET /tasks?view=` and `GET /views/:id/tasks`. Phase 2 replaces both with
   `POST /api/v1/views/query` (`{scope, config, groupValue?, cursor?, limit?}`), so a saved view and an
   unsaved URL state compile through the same code. Saved views are `GET /locations/:id/views`,
   `GET /workspaces/:id/views`, `POST /views` and `GET|PATCH|DELETE /views/:id`. `GET /tasks` keeps its
   phase 1 contract and is not used by the phase 2 renderers.
2. **Module graph (AD-1, AD-2).** `view` may use `task, workspace, field, shared` and `realtime` may use
   `workspace, shared`; no other module changes. `TaskView` and `Priority` moved from `task.internal` to
   `com.taskflow.task` (the OpenAPI schema names are unchanged) and `task.TaskReader.views(ids)` is the
   public batch loader, so `view` never reads task internals and never writes tasks.
3. **jOOQ without code generation (AD-3).** `spring-boot-starter-jooq` with plain `DSL.table/field`
   references declared once in `view/internal/Schema.java`. Flyway stays the only schema owner.
4. **Visibility rule as a jOOQ template (AD-7).** `LocationAccess.visible(alias)` uses `:uid` and `:role`
   named parameters, which jOOQ plain SQL does not bind. `LocationAccess.condition(alias)` returns the
   same SQL with `{0}` (user id) and `{1}` (role) placeholders; both forms come from one private builder
   so they cannot diverge.
5. **Move extended (AD-9).** `POST /tasks/:id/move` accepts optional `statusName`, `priority`,
   `assigneeFrom`, `assigneeTo` and `keepRank`. One transaction: the guarded `UPDATE task ... WHERE
   version = ?`, then the `task_assignee` rows, then one `task.moved` event. The client never sends a rank.
6. **`clientId` only in the outbox payload (AD-12).** The activity API returns payloads, and a tab id is
   not activity. `EventRecorder` writes `clientId` (from the `X-Client-Id` header, a filter-managed
   ThreadLocal that is empty outside a request) to the outbox row only.
7. **Pre-phase-2 outbox rows are marked published** by a migration, so the first relay start does not
   replay history that no consumer ever needed.
8. **Scheduling is unconditional.** A `shared` configuration enables scheduling with a pool of 4 threads
   and Redis calls time out after 2 s, so the relay and the presence sweep keep running when the purge
   scheduler is switched off or slow.
9. **`identity` publishes the `JwtDecoder` as a bean.** `realtime` injects the Spring type and needs no
   dependency on `identity`.
10. **Guests are not allowed on `/topic/workspace/:id` (AD-13/AD-14).** WORKSPACE VIEW includes guests,
    who may see only granted subtrees, and workspace-topic events carry ids from every non-private Space.
    A guest subscribes to the Location topics of its granted Locations. The STOMP interceptor is
    deny-by-default: SEND only to `/app/presence/{taskId}`, SUBSCRIBE only to the four known topic
    patterns.
11. **Subscriptions are checked at SUBSCRIBE only.** A revoked grant or a removed member keeps a live
    subscription until the client reconnects or the access token expires (at most 15 minutes). Payloads
    hold ids, type and version only. Accepted for this phase.
12. **Default views are virtual** (AD-8). Every Space, Folder, List and the Workspace home list one
    `default-list` and one `default-board` with `id: null`; no migration backfills views. Saving one
    inserts a `SHARED` row with `default_kind`, unique per `(workspace_id, location_id, default_kind)`
    (`NULLS NOT DISTINCT`, partial), which replaces the virtual one. Deleting a stored default reverts to
    the virtual one. The strings `default-list` and `default-board` are frontend route ids and never reach
    an API path.
13. **Search (AD-18).** See the migration `V202611250920__task_search.sql` for the column that was used.
14. **Frontend libraries.** Exact versions are pinned in `frontend/package-lock.json`; see the Versions
    section below.
15. **Seed idempotency** looks entities up by stable name; `Idempotency-Key` is only a retry guard because
    its records are purged after 24 hours.

## Versions

Recorded when the libraries were installed (S7).
