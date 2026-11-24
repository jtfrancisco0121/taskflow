-- workspace owns location_grant (AD-2, AD-3): who may see a private location and its subtree.
CREATE TABLE location_grant (
    workspace_id uuid        NOT NULL,
    location_id  uuid        NOT NULL,
    user_id      uuid        NOT NULL,
    granted_by   uuid        NOT NULL REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, location_id, user_id),
    FOREIGN KEY (workspace_id, location_id) REFERENCES location (workspace_id, id),
    -- Leaving or being removed from the workspace drops the grants with it.
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_member (workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX location_grant_user_idx ON location_grant (workspace_id, user_id);
