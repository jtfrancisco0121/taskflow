-- automation owns rules and their run log (3C S2, decision 009). A rule belongs to one Location and applies to
-- every task of the Lists at or below it. Trigger, conditions and actions are typed JSON written only after
-- parsing (AD-14). Delete is soft; runs are kept.
CREATE TABLE automation_rule (
    id                uuid PRIMARY KEY,
    workspace_id      uuid        NOT NULL,
    location_id       uuid        NOT NULL,
    name              text        NOT NULL,
    enabled           boolean     NOT NULL DEFAULT true,
    trigger           jsonb       NOT NULL,
    conditions        jsonb       NOT NULL DEFAULT '[]',
    actions           jsonb       NOT NULL,
    version           bigint      NOT NULL DEFAULT 1,
    created_by        uuid        NOT NULL REFERENCES app_user (id),
    created_by_key_id uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    CONSTRAINT automation_rule_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id)
);

CREATE INDEX automation_rule_location_idx
    ON automation_rule (workspace_id, location_id, created_at, id) WHERE deleted_at IS NULL;

-- One row per rule and source event (AD-3): a redelivered event never runs a rule twice.
CREATE TABLE automation_run (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    rule_id      uuid        NOT NULL REFERENCES automation_rule (id),
    task_id      uuid        NOT NULL,
    event_id     uuid        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('SUCCEEDED', 'SKIPPED', 'FAILED')),
    reason       text,
    error        text,
    retryable    boolean     NOT NULL DEFAULT false,
    attempt      int         NOT NULL DEFAULT 1,
    depth        int         NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX automation_run_rule_event_idx ON automation_run (rule_id, event_id);
CREATE INDEX automation_run_rule_created_idx ON automation_run (rule_id, created_at DESC, id DESC);
CREATE INDEX automation_run_guard_idx ON automation_run (rule_id, task_id, created_at DESC);
