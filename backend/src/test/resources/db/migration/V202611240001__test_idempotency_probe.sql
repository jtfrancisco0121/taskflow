-- Test-only tables for IdempotencyIT and EventRecorderIT. Never packaged: src/test only.
CREATE TABLE idem_effect (
    id   uuid PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE idem_probe (
    id        uuid PRIMARY KEY,
    name      text NOT NULL UNIQUE,
    parent_id uuid REFERENCES idem_probe (id)
);
