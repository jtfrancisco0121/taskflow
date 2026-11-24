-- identity owns the "Automation" author of each Workspace (3C S3, decision 009.5). Rule-made comments and
-- subtasks are authored by it, because created_by and author_id reference app_user and a rule id is not a user.
-- It has no email and no password, never joins workspace_member and cannot sign in.
ALTER TABLE app_user DROP CONSTRAINT app_user_kind_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_kind_check
    CHECK (kind IN ('HUMAN', 'SERVICE_ACCOUNT', 'AUTOMATION'));

CREATE TABLE automation_author (
    workspace_id uuid PRIMARY KEY REFERENCES workspace (id),
    user_id      uuid        NOT NULL UNIQUE REFERENCES app_user (id),
    created_at   timestamptz NOT NULL DEFAULT now()
);
