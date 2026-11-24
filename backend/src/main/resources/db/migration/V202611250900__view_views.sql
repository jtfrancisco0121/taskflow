-- view owns view and view_share (AD-2, AD-8). location_id NULL means a Workspace-scope view.
CREATE TABLE view (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL REFERENCES workspace (id),
    location_id  uuid,
    owner_id     uuid        NOT NULL REFERENCES app_user (id),
    name         text        NOT NULL,
    type         text        NOT NULL CHECK (type IN ('LIST', 'BOARD', 'TABLE', 'CALENDAR')),
    visibility   text        NOT NULL CHECK (visibility IN ('SHARED', 'PERSONAL', 'PRIVATE')),
    default_kind text        CHECK (default_kind IN ('LIST', 'BOARD')),
    config       jsonb       NOT NULL,
    rank         text COLLATE "C" NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT view_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id),
    CONSTRAINT view_default_matches_type CHECK (default_kind IS NULL OR default_kind = type)
);

-- One stored default per kind per Location or Workspace; ordinary views (default_kind NULL) are
-- never constrained.
CREATE UNIQUE INDEX view_default_uq
    ON view (workspace_id, location_id, default_kind) NULLS NOT DISTINCT
    WHERE default_kind IS NOT NULL;

CREATE INDEX view_scope_idx ON view (workspace_id, location_id, rank, id);

CREATE TABLE view_share (
    view_id      uuid NOT NULL REFERENCES view (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL,
    workspace_id uuid NOT NULL,
    PRIMARY KEY (view_id, user_id),
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_member (workspace_id, user_id) ON DELETE CASCADE
);
