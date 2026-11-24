-- workspace owns workspace and workspace_member (AD-2).
CREATE TABLE workspace (
    id         uuid PRIMARY KEY,
    name       text        NOT NULL,
    key        text        NOT NULL CHECK (key ~ '^[A-Z]{2,6}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE workspace_member (
    workspace_id uuid        NOT NULL REFERENCES workspace (id),
    user_id      uuid        NOT NULL REFERENCES app_user (id),
    role         text        NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER', 'GUEST')),
    joined_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_member_user_idx ON workspace_member (user_id);
