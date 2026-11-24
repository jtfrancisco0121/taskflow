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
