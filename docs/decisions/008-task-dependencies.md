# 008: Task dependencies and relationships

Status: accepted. Context: Phase 3B adds relationships between tasks (DEP-1..DEP-6): "waiting on" (also
"blocked by"), "blocking" and a generic "linked to".

## Decision

1. **Migration window `V202612020000`-`V202612022359`.** The request named `V400`-`V499`. Flyway orders
   versions numerically and `application.yml` sets no `outOfOrder`, so `V400` sorts below every applied
   timestamp version and fails validation on every existing database (decision 006.1). The one migration is
   `V202612020900__task_dependencies.sql`. 3C must reserve a different day (decision 006.3).
2. **One canonical row per related pair.** `task_dependency(task_id, depends_on_id, type)`; `WAITING_ON`
   means `task_id` waits on `depends_on_id`, `LINKED` is stored with `task_id < depends_on_id`. A unique
   index on the unordered pair forbids a second relationship of any kind or direction. Both ends are in the
   row's Workspace through composite foreign keys; a purge cascades.
3. **"Waiting on" and "blocked by" are the same relation.** Only "linked to" is a separate, non-blocking
   kind. The API takes `WAITING_ON` (alias `BLOCKED_BY`), `BLOCKING` or `LINKED` from the acting task's side.
4. **Blocked is derived, never stored.** `com.taskflow.task.BlockedSql` is the one definition: a task is
   blocked while a `WAITING_ON` blocker is not trashed, not in a deleted List, and in a status group
   `NOT_STARTED` or `ACTIVE`. Task reads, the `blocked` view filter, workspace search and MCP search use it.
5. **Writes serialise per Workspace.** A transaction-scoped advisory lock (own namespace), then both task
   rows `FOR UPDATE` in id order, then the `If-Match` comparison, the cycle check (recursive CTE over
   `WAITING_ON` rows, trashed tasks included), the insert and the version bump of both tasks. A lock wait
   (5 s) or a deadlock is answered `409 dependency.busy`; the transaction is owned by the idempotency
   filter, so there is no retry inside it and the client retries with the same key.
6. **One choke point for blocker events.** `BlockerTransitions` records `task.blocker_resolved` and
   `task.blocker_reopened` on each live dependent whenever a blocker crosses the finished boundary: a status
   change, a move, a status-set remap, an edit of a status group, trash or restore. Dependent versions are
   not bumped. Delivery of notifications belongs to 3C, which consumes these events by outbox id.
7. **Completing a blocked task is allowed.** The API answers 200 and the activity entry carries
   `completedWhileBlocked: true`; the UI warns before it sends the change.

## Consequences

- Any new code that writes `task.status_id` or `task.deleted_at` must call `BlockerTransitions`.
- Deleting a Location does not publish blocker events (deferred; views refetch on location events).
