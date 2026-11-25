-- notification owns the inbox and the watch state (3C S6, decision 009). Created idempotently from outbox
-- events: the unique keys below are what makes a redelivered event a no-op (AD-3).
CREATE TABLE notification (
    id              uuid PRIMARY KEY,
    workspace_id    uuid        NOT NULL,
    recipient_id    uuid        NOT NULL REFERENCES app_user (id),
    kind            text        NOT NULL CHECK (kind IN (
        'ASSIGNED', 'MENTIONED', 'COMMENTED', 'STATUS_CHANGED', 'DUE_SOON', 'BLOCKER_RESOLVED',
        'AUTOMATION')),
    task_id         uuid        NOT NULL,
    comment_id      uuid,
    source_event_id uuid        NOT NULL,
    actor_type      text        NOT NULL,
    actor_id        uuid        NOT NULL,
    actor_key_id    uuid,
    rule_name       text,
    message         text,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX notification_source_idx ON notification (recipient_id, source_event_id, kind);
-- A comment edit that keeps a mention never notifies again.
CREATE UNIQUE INDEX notification_mention_idx ON notification (recipient_id, comment_id)
    WHERE kind = 'MENTIONED';
CREATE INDEX notification_inbox_idx
    ON notification (recipient_id, workspace_id, created_at DESC, id DESC);
CREATE INDEX notification_unread_idx ON notification (recipient_id, workspace_id) WHERE read_at IS NULL;

-- watching = false keeps an explicit unwatch from being undone by the next automatic watch (AD-19).
CREATE TABLE task_watcher (
    workspace_id uuid        NOT NULL,
    task_id      uuid        NOT NULL,
    user_id      uuid        NOT NULL REFERENCES app_user (id),
    watching     boolean     NOT NULL DEFAULT true,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX task_watcher_user_idx ON task_watcher (user_id);
