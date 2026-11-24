-- task owns comment and comment_mention (AD-2). Deleting a comment is soft; mentions follow the body.
CREATE TABLE comment (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    task_id      uuid        NOT NULL,
    author_id    uuid        NOT NULL REFERENCES app_user (id),
    body         jsonb       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    edited_at    timestamptz,
    deleted_at   timestamptz,
    CONSTRAINT comment_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX comment_task_idx ON comment (workspace_id, task_id, id);

CREATE TABLE comment_mention (
    workspace_id uuid NOT NULL,
    comment_id   uuid NOT NULL,
    user_id      uuid NOT NULL,
    PRIMARY KEY (comment_id, user_id),
    FOREIGN KEY (workspace_id, comment_id) REFERENCES comment (workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_member (workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX comment_mention_user_idx ON comment_mention (workspace_id, user_id);
