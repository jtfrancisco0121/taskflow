-- identity: a sign-out that could not take its family lock records the family here first (ClickUp
-- 14yq6g334r6 slice 2, decision 010). The next refresh of any token in the family sees the row under
-- the family lock, revokes the family and answers 401. The row is deleted when the family is revoked.
-- family_id is not a foreign key: refresh_token has one row per token, not per family.
CREATE TABLE refresh_pending_revocation (
    family_id  uuid        PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
