# 007: Phase 3A custom fields

Status: accepted (built in slices 3A S2..S8; this record grows with each). Context: FIELD-1..3. It follows
`docs/architecture.md` sections 5 and 7 and records where it differs or adds detail.

## Decisions

1. **Definitions are relational, values are JSONB.** `custom_field`, `custom_field_option` and
   `custom_field_hidden` hold definitions; values live in the existing `task.custom` keyed by field id.
   Dropdown and Labels values store Option ids, never names, so a rename cannot touch a value.
2. **Definitions are soft-retired and type-immutable.** No statement deletes a `custom_field` or
   `custom_field_option` row and none updates `custom_field.type`; retire sets `retired_at`. Ids are
   UUIDv7 and never reused. A retired field or Option is empty to every read and filter, and its stored
   values stay in `task.custom` untouched. There is no restore endpoint yet; the data is kept so it can
   be added without a migration. A retired Option's name is free again for a new Option.
3. **One effective-set function (`field.FieldCatalog.effective`).** Live fields defined at the location
   or an ancestor, minus fields hidden at the location or an ancestor, ordered by depth (Space first)
   then rank. A hide is accepted only for a field defined at a strict ancestor (400 `field.hide_own`
   otherwise); fields a Folder hides do not appear at all in the manager of a List below it.
4. **One live field name per branch.** Names are trimmed and compared case-insensitively over live fields
   defined at the ancestors, the location itself and every descendant location of any type (archived and
   deleted included, so a restore cannot create a clash). Sibling branches may reuse a name. Option names
   are unique per field among live Options (`field.option_name_taken`) so name-to-id resolution is never
   ambiguous. Limits: 50 own fields, 100 effective, 200 Options.
5. **Definition writes serialise per Workspace on a field-namespaced advisory lock.** The two-int
   `pg_advisory_xact_lock(0x464c4400, hash(workspaceId))` never collides with `WorkspaceLock`. Lock
   order: a Location move holds the workspace lock and the row lock `FOR UPDATE` of its target parent,
   then `FieldMoveListener` takes the field lock. A field write first takes `FOR KEY SHARE` on its
   Location row (so it waits for a concurrent move while holding nothing), then the field lock, and
   never the workspace lock, so the two cannot form a cycle (risk review, LOW 1). `CustomFieldIT` races
   moves against creates at the target.
6. **A Location move that would clash is refused.** `FieldMoveListener` (a synchronous `@EventListener`
   like `StatusRemapListener`) answers 409 `field.name_taken` naming both fields when a live field in the
   moved subtree shares a name with a live field at the new ancestors; the move rolls back. Values of
   fields a moved List leaves behind stay in `task.custom` and come back if the List returns.
7. **Versions.** `custom_field.version` starts at 1 and rises on every update (name, config, Options,
   order) and retire; `PATCH` and `DELETE /fields/{id}` need `If-Match`, a stale one answers 409
   `field.stale` with the current field. A `PATCH` is a merge patch; `options` is the full ordered list
   (entries with an id are kept, new ones are added, missing ones are retired).
8. **Permissions mirror statuses.** Reading needs `LOCATION VIEW`; creating, editing, retiring, hiding
   and unhiding need `LOCATION EDIT` on the defining (or hiding) Location, so a Space-level field is for
   admins and owners. The `FIELD` resolver only gates visibility (404); the edit check runs in the service
   against the defining Location.
9. **Events.** Definition changes are recorded with entity `location`, entity id the Location acted on,
   types `custom_field.created|updated|retired|hidden|unhidden` and payload `{fieldId, parentId, path}`.
10. **Option colors are a ten-name palette** (gray, red, orange, amber, green, teal, blue, indigo, purple,
    pink), never arbitrary hex; the UI draws them as a dot only.
11. **The People type is built last (3A S8).** The `custom_field.type` CHECK lists all twelve types, so no
    later migration is needed; until S8 the API answers 400 `field.invalid_type` for it.
12. **Deviation: no request-scoped catalog cache.** The effective set is one query; the task projection
    (S3) resolves it once per distinct List, which is where repeated lookups would happen.
13. **Values: key-level merge only (AD-2).** `task.custom` holds `{fieldId: value}`. A write is
    `custom = (custom - <cleared keys>) || <set object>` inside the versioned `UPDATE` (one version bump
    per request, whatever the number of fields); no code path assigns `task.custom` from a client object and
    no definition change updates a `task` row, so hidden, retired and out-of-scope values survive.
    `customFields` keys may be field ids or, for agents, field names of the List's effective fields; a
    Dropdown or Labels value may be an Option id or its name (case-insensitive), stored as the id. Errors:
    400 `field.invalid_value` (naming the field and, for Options, the valid names) and
    400 `field.not_available` (not effective on the List, or hidden there). A value equal to the stored one
    is a no-op: no version, no event.
14. **Projection (AD-13).** `TaskView.customFields` holds only values of the task's effective fields,
    with retired Options removed (a Dropdown on a retired Option is omitted; Labels are filtered). The
    task repository resolves the effective set once per distinct List of a page.
15. **Activity snapshots (AD-7).** `changes.customFields` carries, per field, `from`/`to` (the stored
    shapes, omitted for LONG_TEXT whose value is read from the task) plus `field`, `fromText`, `toText`
    taken at write time and cut to 200 characters, so a later rename does not rewrite history and one
    request cannot publish events of hundreds of KB.
16. **One GIN index instead of per-field expression indexes.** `task_custom_gin_idx` (`jsonb_path_ops`)
    serves containment predicates; this deviates from architecture "index hot fields" because DDL from
    user actions is unsafe and the demo size does not need more. It is a plain `CREATE INDEX` in Flyway's
    transaction, so it blocks task writes while it builds: harmless at current sizes. A large deployment
    should build it out of band with `CREATE INDEX CONCURRENTLY` (`executeInTransaction=false`) first.
    Expression indexes are the follow-up if SM-2 (p95 under 300 ms with a custom filter and sort) fails.
17. **Views show fields as `cf:<fieldId>` columns.** The URL `c` and a saved config carry the column as
    `cf:<uuid>` (a width is a trailing `:<digits>`); `ViewConfigValidator` accepts a well-formed reference
    (S5 adds the check that the field is live on the scope's branch). The Columns picker offers the fields
    effective at the view's location, with where they come from; fields defined only on descendants of a
    Space or Folder scope are not offered yet (deferred). Cells edit inline through the shared optimistic
    task mutation (one update per edit, rollback and toast on 400 or 409); Board cards show up to three
    chips of filled fields and "+N".
18. **Fix found on the way: the Table view re-rendered in a loop in a real browser.** `TableRenderer` fed
    TanStack Table a new `data` array on every render, so the table's auto-reset updated its state in a
    loop (thousands of renders per second) and starved router transitions, so a URL parameter change such as
    a new column never showed. `useViewTasks` now returns a memoised `items` array and the Table memoises
    its task list.
