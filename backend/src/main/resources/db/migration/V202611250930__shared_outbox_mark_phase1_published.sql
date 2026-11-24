-- No consumer existed before the relay (phase 2), so replaying history on the first start would
-- only flood Redis and clients. Rows written before this migration count as published.
UPDATE outbox_event SET published_at = created_at WHERE published_at IS NULL;
