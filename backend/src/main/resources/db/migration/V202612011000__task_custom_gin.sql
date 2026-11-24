-- One GIN index (jsonb_path_ops) on task.custom serves the containment predicates of custom field
-- filters (3A S5) instead of per-field expression indexes (decision 007). A plain CREATE INDEX blocks
-- writes to task while it builds: harmless at current sizes. For a large deployment build it out of
-- band with CREATE INDEX CONCURRENTLY (Flyway executeInTransaction=false) before applying this.
CREATE INDEX task_custom_gin_idx ON task USING gin (custom jsonb_path_ops);
