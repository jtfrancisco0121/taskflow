-- workspace owns invite (AD-2, AD-21). Only the SHA-256 of the token is stored.
CREATE TABLE invite (
    id           uuid PRIMARY KEY,
    workspace_id uuid        NOT NULL REFERENCES workspace (id),
    email        text        NOT NULL,
    role         text        NOT NULL CHECK (role IN ('ADMIN', 'MEMBER', 'GUEST')),
    token_hash   text        NOT NULL UNIQUE,
    invited_by   uuid        NOT NULL REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    accepted_at  timestamptz,
    revoked_at   timestamptz
);

CREATE INDEX invite_workspace_idx ON invite (workspace_id, id);
CREATE INDEX invite_email_idx ON invite (lower(email));
