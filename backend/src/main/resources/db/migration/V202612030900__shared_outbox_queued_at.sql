-- A second relay publishes outbox rows to RabbitMQ (decision 009.2). It has its own marker so the Redis
-- relay (published_at) never waits on the broker, and the broker never waits on Redis.
ALTER TABLE outbox_event ADD COLUMN queued_at timestamptz;
ALTER TABLE outbox_event ADD COLUMN queue_claimed_until timestamptz;

-- History that exists at deploy time must never start a rule or a notification.
UPDATE outbox_event SET queued_at = now();

CREATE INDEX outbox_event_unqueued_idx ON outbox_event (created_at, id) WHERE queued_at IS NULL;
