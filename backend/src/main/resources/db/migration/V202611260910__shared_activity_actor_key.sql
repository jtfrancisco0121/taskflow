-- Which API key made a change, for attribution and the audit view. Null for users and jobs.
ALTER TABLE activity_event ADD COLUMN actor_key_id uuid;
ALTER TABLE outbox_event ADD COLUMN actor_key_id uuid;

CREATE INDEX activity_event_actor_idx
    ON activity_event (workspace_id, actor_type, actor_id, created_at DESC, id DESC);
