-- notification owns per-person preferences per Workspace and kind (3C S8, CAP-13). A missing row is the
-- default: in-app on for every kind, email digest on for ASSIGNED and MENTIONED only.
CREATE TABLE notification_preference (
    workspace_id  uuid        NOT NULL REFERENCES workspace (id),
    user_id       uuid        NOT NULL REFERENCES app_user (id),
    kind          text        NOT NULL CHECK (kind IN (
        'ASSIGNED', 'MENTIONED', 'COMMENTED', 'STATUS_CHANGED', 'DUE_SOON', 'BLOCKER_RESOLVED',
        'AUTOMATION')),
    in_app        boolean     NOT NULL,
    email_digest  boolean     NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id, kind)
);
