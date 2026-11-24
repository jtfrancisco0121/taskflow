-- Task relationships (DEP-1..DEP-6, decision 008). One canonical row per related pair:
-- WAITING_ON means task_id waits on depends_on_id; LINKED is stored with task_id < depends_on_id.
-- The composite foreign keys keep both ends in the row's Workspace and let a purge cascade.
CREATE TABLE task_dependency (
    id            uuid PRIMARY KEY,
    workspace_id  uuid        NOT NULL,
    task_id       uuid        NOT NULL,
    depends_on_id uuid        NOT NULL,
    type          text        NOT NULL,
    created_by    uuid        NOT NULL REFERENCES app_user (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_dependency_type_check CHECK (type IN ('WAITING_ON', 'LINKED')),
    CONSTRAINT task_dependency_not_self CHECK (task_id <> depends_on_id),
    CONSTRAINT task_dependency_link_order CHECK (type <> 'LINKED' OR task_id < depends_on_id),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, depends_on_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

-- One relationship per unordered pair, whatever its kind or direction.
CREATE UNIQUE INDEX task_dependency_pair_key
    ON task_dependency (workspace_id, LEAST(task_id, depends_on_id), GREATEST(task_id, depends_on_id));
CREATE INDEX task_dependency_task_idx ON task_dependency (workspace_id, task_id);
CREATE INDEX task_dependency_depends_on_idx ON task_dependency (workspace_id, depends_on_id);
