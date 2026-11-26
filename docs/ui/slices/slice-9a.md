# Slice 9a report: notifications and the field manager

Slice 9a (subtask of slice 9; 9b is automations and statuses, 9c service accounts) changes `frontend/` and `docs/ui/`
only: no API, no schema, no backend file, no new dependency. Risk: medium.

## Design note
- **Inbox** (`InboxPage`): `PageHeader`; Unread/All tabs keep `role="tab"` with token classes (the active one on the
  primary gradient); rows on `surface` with a `line` border, an accent dot (`role="img"`, "Unread") on unread rows,
  muted text on read rows, `faint` timestamps. Loading: "Loading the inbox" status with `Skeleton` rows. Error:
  `ErrorState` with Retry (refetch). Empty: `EmptyState` ("You're all caught up." / "No notifications yet.").
- **Bell** (`NotificationBell`): the emoji becomes an SVG bell; the popover list loads with skeletons, fails with
  `ErrorState` + Retry, and keeps its empty line. Count, "99+", announcements and the popover are unchanged.
- **Settings** (`NotificationSettingsPage`): `PageHeader`, the table on tokens, the local switch replaced by the library
  Radix `Switch` (same `role="switch"` and names, now Space and Enter by Radix). Loading, error with Retry, and an empty
  state when the server lists no kinds. Optimistic save and rollback are unchanged.
- **Field manager** (`FieldManagerDialog`, `FieldEditor`, `ValueCell`): raw palette classes become tokens; the loading
  rows are `Skeleton`, the error is `ErrorState` with Retry; the empty "Fields here" and "Inherited" lines stay as text.
  `ValueCell` stars use `accent` / `line-strong`, the progress bar `surface-3` / `status-done`.
- `legacy-bridge.css`: the `green-600` variable and the `text-white` and `text-slate-300` overrides had no user left
  after this slice, so the dead-entry guard (`legacy-bridge-usage.test.ts`) required removing them.
- Unchanged: keyboard reorder (Alt+Up/Down), retire confirmation, option editing, `If-Match` versions.

## Acceptance criteria and their tests
| # | Criterion | Test |
|---|---|---|
| 1 | Inbox loading shows a status with skeletons | `Inbox.test.tsx` 9a-1 |
| 2 | Inbox error shows Retry that reloads | `Inbox.test.tsx` 9a-2 |
| 3 | Empty Unread and All tabs are empty states | `Inbox.test.tsx` 9a-3 |
| 4 | Unread rows carry an Unread marker, read rows do not | `Inbox.test.tsx` 9a-4 |
| 5 | Bell popover: error with Retry, then empty | `Inbox.test.tsx` 9a-5 |
| 6 | Bell is an SVG icon, not an emoji | `Inbox.test.tsx` 9a-6 |
| 7 | Settings: error with Retry | `NotificationSettings.test.tsx` 9a-7 |
| 8 | Settings: loading status, empty state | `NotificationSettings.test.tsx` 9a-8 |
| 9 | Settings switch toggles by keyboard and saves | `NotificationSettings.test.tsx` 9a-9 |
| 10 | Notification and field-manager files use tokens only | `tokens-only.test.ts` (slice 9a block) |

The field manager's loading, error with Retry and empty states keep their existing tests
(`FieldManagerDialog.test.tsx`). `e2e/theme-screens.spec.ts` gains the notification settings and the field manager in
both themes (axe contrast on each).

## Bundle size
After `npm run build`, `bash scripts/bundle-size.sh --check`: **447.8 KiB** against the 446.3 KiB cap (slice 8 ended at
446.0, +1.8). Commit a84cc2c raises `bundle-budget.json` to baselineKiB 389.83, so the cap is **448.3 KiB**
(approved by JT Francisco, 2026-11-27); `--check` and `--self-test` pass.
