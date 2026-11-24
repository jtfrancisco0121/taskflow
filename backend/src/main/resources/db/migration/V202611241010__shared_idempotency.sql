-- shared owns idempotency_record (AD-18). A row exists only together with the effect it guards.
CREATE TABLE idempotency_record (
    id           uuid PRIMARY KEY,
    actor_id     uuid        NOT NULL,
    key          text        NOT NULL,
    request_hash text        NOT NULL,
    status       integer,
    headers      jsonb,
    body         bytea,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT idempotency_record_actor_key UNIQUE (actor_id, key)
);

CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);
