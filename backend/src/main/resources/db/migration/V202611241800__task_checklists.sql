-- task owns checklist and checklist_item (AD-2). They disappear with their task.
CREATE TABLE checklist (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    task_id      uuid        NOT NULL,
    name         text        NOT NULL,
    rank         text COLLATE "C" NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT checklist_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX checklist_task_idx ON checklist (workspace_id, task_id, rank, id);

CREATE TABLE checklist_item (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    checklist_id uuid        NOT NULL,
    text         text        NOT NULL,
    checked      boolean     NOT NULL DEFAULT false,
    assignee_id  uuid,
    rank         text COLLATE "C" NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT checklist_item_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, checklist_id) REFERENCES checklist (workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, assignee_id)
        REFERENCES workspace_member (workspace_id, user_id) ON DELETE SET NULL (assignee_id)
);

CREATE INDEX checklist_item_checklist_idx ON checklist_item (workspace_id, checklist_id, rank, id);
