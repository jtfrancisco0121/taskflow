-- field owns custom field definitions (3A S2, decision 007). Values live in task.custom keyed by field id.
-- Rows are never deleted: retire sets retired_at, so ids are never reused and stored values stay valid.
-- The type CHECK lists every type so adding PEOPLE later needs no migration; `type` is never updated.
CREATE TABLE custom_field (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    location_id  uuid        NOT NULL,
    name         text        NOT NULL,
    type         text        NOT NULL CHECK (type IN (
        'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'LABELS', 'CHECKBOX', 'URL', 'EMAIL',
        'PEOPLE', 'RATING', 'PROGRESS')),
    config       jsonb       NOT NULL DEFAULT '{}',
    rank         text COLLATE "C" NOT NULL,
    version      bigint      NOT NULL DEFAULT 1,
    retired_at   timestamptz,
    created_by   uuid        NOT NULL REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT custom_field_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id)
);

CREATE INDEX custom_field_location_idx ON custom_field (workspace_id, location_id, rank, id);

-- Options of DROPDOWN and LABELS fields. Values store the option id, never the name.
CREATE TABLE custom_field_option (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL,
    field_id     uuid        NOT NULL,
    name         text        NOT NULL,
    color        text        NOT NULL DEFAULT 'gray',
    rank         text COLLATE "C" NOT NULL,
    retired_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT custom_field_option_workspace_id_key UNIQUE (workspace_id, id),
    FOREIGN KEY (workspace_id, field_id) REFERENCES custom_field (workspace_id, id)
);

CREATE INDEX custom_field_option_field_idx ON custom_field_option (field_id, rank, id);

-- A lower location hides a field defined at a strict ancestor for its whole subtree.
CREATE TABLE custom_field_hidden (
    workspace_id uuid        NOT NULL,
    location_id  uuid        NOT NULL,
    field_id     uuid        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (location_id, field_id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id),
    FOREIGN KEY (workspace_id, field_id) REFERENCES custom_field (workspace_id, id)
);

CREATE INDEX custom_field_hidden_field_idx ON custom_field_hidden (field_id);
