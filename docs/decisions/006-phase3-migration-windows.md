# 006: Phase 3 migration windows

Status: accepted. Context: Phase 3 is built in several groups (3A custom fields, then the other Phase 3
groups) that may be developed in parallel branches. This record replaces the `V300`-`V399` range that the
3A request named for new migrations.

## Decision

1. **`V300`-`V399` is not used.** Flyway orders migrations numerically and `application.yml` sets no
   `outOfOrder`. Every applied migration is a timestamp version (decision 001.3, the latest at the time
   of writing is `V202611260910__shared_activity_actor_key.sql`), so `V300` sorts below them and fails
   Flyway validation on every existing database. Sequential numbers are ruled out by decision 001.3.
2. **3A (custom fields) uses `V202612010000` to `V202612012359` only.** The planned files are
   `V202612010900__field_custom_fields.sql` and `V202612011000__task_custom_gin.sql`.
3. **Every later Phase 3 group reserves its own timestamp window** (one calendar day or more, after the
   latest applied version) in its own decision record before it adds a migration, so two branches never
   pick the same version and neither sorts below an applied one.
4. Migrations stay add-only: an applied migration is never edited (AGENTS.md).

## Consequences

- A merge that brings in a migration with a version below an already applied one is a bug in the window
  choice, not something to fix with `outOfOrder`.
- If two groups merge in either order, no renumbering of migrations is needed; only the decision record
  numbers (`006`, `007`, ...) may need to be renumbered by whichever merges second.
