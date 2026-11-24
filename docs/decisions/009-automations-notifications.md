# 009: Automations and notifications

Status: accepted. Context: Phase 3C adds a rules engine (AUTO-1..4) and a notification system (NOTIF-1).

## Decision

1. **Migration window `V202612030000`-`V202612032359`.** The request named `V500`-`V599`. Flyway orders
   versions numerically and `application.yml` sets no `outOfOrder`, so `V500` sorts below every applied
   timestamp version and fails validation on every existing database (decisions 006.1, 006.2, 008.1). 3C
   migrations use only this window (`V202612030900` onwards).
2. **RabbitMQ is fed by a second outbox relay with its own marker.** `outbox_event.queued_at` (and a claim
   lease `queue_claimed_until`) are separate from `published_at`; the Redis relay is unchanged. The AMQP
   relay never holds outbox row locks while it talks to the broker: it claims rows in a short committed
   transaction, publishes outside any transaction, waits for publisher confirms, then marks `queued_at` for
   confirmed rows. Rows that existed before the migration are marked queued so old history never starts a
   rule or a notification.
3. **No ShedLock** (deviates from `docs/architecture.md` section 7). The due-date sweep records signals in
   `task_due_signal` with a unique `(task_id, due_date, kind)` key and `ON CONFLICT DO NOTHING`, so several
   instances produce each event once without a lock table.
4. **Consumers run in the API process** behind `taskflow.workers.enabled` (listeners and the due sweep) and
   `taskflow.outbox.amqp.enabled` (the AMQP relay). A worker split is a configuration change later.
5. **One "Automation" app user per Workspace** (`app_user.kind = 'AUTOMATION'`, side table
   `automation_author`) authors rule-made comments and subtasks, because `created_by` / `author_id`
   reference `app_user`. The activity actor is `AUTOMATION` with the rule id; the rule name travels in the
   event payload (`automation.ruleName`).
6. **`notification` is an eleventh module** and never depends on `automation`: the Send notification action
   records `automation.notify_requested`.
7. **Notifications reach the browser only through `/topic/user/{userId}`**, checked at SUBSCRIBE against the
   session's user.
8. **A rule acts only on tasks its creator can VIEW at run time**; otherwise the run is skipped
   (`no_access`).
9. **Failures are classified.** A refused action (4xx other than 409) is a terminal FAILED run, not
   retried. Transient failures (409, recoverable data access and broker errors, see
   `shared/TransientFailures`) retry 3 times (1 s / 5 s / 25 s) and then reach the DLQ.
10. **MCP tools:** `list_automations`, `create_automation`, `toggle_automation`, `list_notifications`,
    `mark_notification_read`. The notification tools act on the service account owner's inbox
    (`notification.no_owner` when there is none).
