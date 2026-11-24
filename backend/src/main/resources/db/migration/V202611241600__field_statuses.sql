-- field owns status (AD-2, AD-12). A location defines its own set iff it has live rows here.
-- Retired rows stay so ids are never reused and tasks that referenced them stay valid.
CREATE TABLE status (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    location_id  uuid        NOT NULL,
    name         text        NOT NULL,
    status_group text        NOT NULL
        CHECK (status_group IN ('NOT_STARTED', 'ACTIVE', 'DONE', 'CLOSED')),
    color        text        NOT NULL DEFAULT '#9ca3af',
    rank         text COLLATE "C" NOT NULL,
    retired_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT status_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id)
);

CREATE INDEX status_location_idx ON status (workspace_id, location_id, rank, id);
