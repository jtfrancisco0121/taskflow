-- workspace owns location (AD-2, AD-9, AD-16): Spaces, Folders and Lists in one tree.
CREATE TABLE location (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL REFERENCES workspace (id),
    parent_id    uuid,
    type         text        NOT NULL CHECK (type IN ('SPACE', 'FOLDER', 'LIST')),
    name         text        NOT NULL,
    path         ltree       NOT NULL,
    is_private   boolean     NOT NULL DEFAULT false,
    rank         text COLLATE "C" NOT NULL,
    archived_at  timestamptz,
    deleted_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT location_workspace_id_key UNIQUE (workspace_id, id),
    CONSTRAINT location_parent_fk FOREIGN KEY (workspace_id, parent_id)
        REFERENCES location (workspace_id, id),
    CONSTRAINT location_space_has_no_parent CHECK ((type = 'SPACE') = (parent_id IS NULL))
);

CREATE INDEX location_path_idx ON location USING gist (path);
CREATE INDEX location_children_idx ON location (workspace_id, parent_id, rank, id);
