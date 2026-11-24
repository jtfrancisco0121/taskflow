-- shared owns outbox_event and activity_event (AD-2, AD-7). Written only by EventRecorder.
CREATE TABLE outbox_event (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    entity       text        NOT NULL,
    entity_id    uuid        NOT NULL,
    type         text        NOT NULL,
    payload      jsonb       NOT NULL,
    actor_type   text        NOT NULL CHECK (actor_type IN ('USER', 'SERVICE_ACCOUNT', 'AUTOMATION')),
    actor_id     uuid        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX outbox_event_unpublished_idx ON outbox_event (created_at) WHERE published_at IS NULL;

CREATE TABLE activity_event (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    entity       text        NOT NULL,
    entity_id    uuid        NOT NULL,
    type         text        NOT NULL,
    payload      jsonb       NOT NULL,
    actor_type   text        NOT NULL CHECK (actor_type IN ('USER', 'SERVICE_ACCOUNT', 'AUTOMATION')),
    actor_id     uuid        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_event_entity_idx
    ON activity_event (workspace_id, entity, entity_id, created_at DESC, id DESC);
