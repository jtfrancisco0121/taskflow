-- task owns task_number_counter, task, task_assignee and task_tag (AD-2, AD-11, AD-14, AD-15).
CREATE TABLE task_number_counter (
    workspace_id uuid   PRIMARY KEY REFERENCES workspace (id),
    next_number  bigint NOT NULL
);

CREATE TABLE task (
    id             uuid PRIMARY KEY,
    workspace_id   uuid        NOT NULL,
    list_id        uuid        NOT NULL,
    parent_task_id uuid,
    status_id      uuid        NOT NULL,
    number         bigint      NOT NULL,
    title          text        NOT NULL,
    description    jsonb,
    priority       text        NOT NULL DEFAULT 'NONE'
        CHECK (priority IN ('URGENT', 'HIGH', 'NORMAL', 'LOW', 'NONE')),
    start_date     timestamptz,
    due_date       timestamptz,
    rank           text COLLATE "C" NOT NULL,
    custom         jsonb       NOT NULL DEFAULT '{}',
    version        bigint      NOT NULL DEFAULT 1,
    created_by     uuid        NOT NULL REFERENCES app_user (id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    trash_batch_id uuid,
    CONSTRAINT task_workspace_id_key UNIQUE (workspace_id, id),
    CONSTRAINT task_workspace_number_key UNIQUE (workspace_id, number),
    FOREIGN KEY (workspace_id, list_id) REFERENCES location (workspace_id, id),
    FOREIGN KEY (workspace_id, status_id) REFERENCES status (workspace_id, id),
    FOREIGN KEY (workspace_id, parent_task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX task_list_rank_idx ON task (workspace_id, list_id, parent_task_id, rank, id);
CREATE INDEX task_parent_idx ON task (workspace_id, parent_task_id);
CREATE INDEX task_trash_idx ON task (workspace_id, trash_batch_id) WHERE trash_batch_id IS NOT NULL;

CREATE TABLE task_assignee (
    workspace_id uuid NOT NULL,
    task_id      uuid NOT NULL,
    user_id      uuid NOT NULL,
    PRIMARY KEY (task_id, user_id),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_member (workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX task_assignee_user_idx ON task_assignee (workspace_id, user_id);

CREATE TABLE task_tag (
    workspace_id uuid NOT NULL,
    task_id      uuid NOT NULL,
    tag          text NOT NULL,
    PRIMARY KEY (task_id, tag),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);
