-- identity owns service accounts and API keys. A service account is an app_user row of kind
-- SERVICE_ACCOUNT (no email, no password) with a same-id service_account row, so every FK that
-- references app_user (created_by, author_id, owner_id) works for agents too. It never joins
-- workspace_member: workspace.roleOf resolves it to ADMIN in its own Workspace.
ALTER TABLE app_user ADD COLUMN kind text NOT NULL DEFAULT 'HUMAN'
    CHECK (kind IN ('HUMAN', 'SERVICE_ACCOUNT'));
ALTER TABLE app_user ALTER COLUMN email DROP NOT NULL;
ALTER TABLE app_user ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE app_user ADD CONSTRAINT app_user_human_complete
    CHECK (kind <> 'HUMAN' OR (email IS NOT NULL AND password_hash IS NOT NULL));

CREATE TABLE service_account (
    id           uuid PRIMARY KEY REFERENCES app_user (id),
    workspace_id uuid        NOT NULL REFERENCES workspace (id),
    name         text        NOT NULL,
    created_by   uuid REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    disabled_at  timestamptz
);

CREATE UNIQUE INDEX service_account_name_idx ON service_account (workspace_id, lower(name));

CREATE TABLE api_key (
    id                 uuid PRIMARY KEY,
    workspace_id       uuid        NOT NULL REFERENCES workspace (id),
    service_account_id uuid        NOT NULL REFERENCES service_account (id),
    name               text        NOT NULL,
    key_hash           text        NOT NULL UNIQUE,
    prefix             text        NOT NULL,
    last4              text        NOT NULL,
    expires_at         timestamptz,
    last_used_at       timestamptz,
    revoked_at         timestamptz,
    created_by         uuid REFERENCES app_user (id),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_key_service_account_idx ON api_key (service_account_id);

CREATE TABLE api_key_usage_daily (
    workspace_id uuid   NOT NULL,
    api_key_id   uuid   NOT NULL REFERENCES api_key (id),
    day          date   NOT NULL,
    calls        bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (api_key_id, day)
);
