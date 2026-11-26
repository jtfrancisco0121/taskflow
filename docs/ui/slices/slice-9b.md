# Slice 9b report: automations, run history and the status manager

Slice 9b (subtask of slice 9; 9a is notifications and fields, 9c service accounts and agent access) changes
`frontend/` and `docs/ui/` only: no API, no schema, no backend file, no new dependency. Risk: medium.

## Design note
- **Automations page** (`AutomationsPage`): `PageHeader` with the location name, the back link and New rule. Loading is
  a "Loading automations" status with `Skeleton` cards. A failed load is an `ErrorState` with Retry (refetches the
  rules and the location); a 404 keeps its not-found message without Retry. No rules is an `EmptyState`; only an
  editor gets the "what a rule does" sentence. Read-only notice, limit notice and delete confirmation use tokens.
- **Rule card** (`RuleCard`): `surface` card with a `line` border; the hand-made switch becomes the library Radix
  `Switch` (same `role="switch"` and name, Space and Enter now handled by Radix); the Off badge and the last-run pill
  use `warn-soft`, `ok-soft`, `danger-soft`.
- **Run history** (`RunsSheet`): "Loading runs" status with skeletons, `ErrorState` with Retry, `EmptyState` "No runs
  yet", outcome pills on soft token backgrounds, failed-run error text on `danger-soft`. Load more is unchanged.
- **Rule builder** (`RuleBuilder`): fieldsets, inputs, hints and errors use tokens; the native checkboxes (Unassign
  everyone, Clear the due date, Assignees, Watchers) become the library `Checkbox`. Payloads are unchanged.
- **Status manager** (`StatusesDialog`, `StatusEditor`, `ResetPanel`): tokens only; loading is a skeleton status,
  load errors (the set, and the parent set in the reset panel) are `ErrorState` with Retry. The editor's default
  colour now reads `COLOR_PRESETS[0]` (the same `#9ca3af`) so no literal colour is left in the file.
- Unchanged: rule versions and `If-Match`, the optimistic toggle with rollback, remap rules when statuses are
  removed, keyboard reorder buttons in the editor.

## Acceptance criteria and their tests
| # | Criterion | Test |
|---|---|---|
| 1 | Automations loading shows a status with skeletons under the header | `AutomationsUi.test.tsx` 9b-1 |
| 2 | Automations error shows Retry that reloads the rules | `AutomationsUi.test.tsx` 9b-2 |
| 3 | No rules is an empty state, with the explanation for an editor | `AutomationsUi.test.tsx` 9b-3 |
| 4 | The rule switch is the library switch and toggles by keyboard | `AutomationsUi.test.tsx` 9b-4 |
| 5 | Run history: loading status, error with Retry, empty state | `AutomationsUi.test.tsx` 9b-5 |
| 6 | Builder options are library checkboxes, keyboard-togglable | `AutomationsUi.test.tsx` 9b-6 |
| 7 | Status dialog: loading status, then error with Retry | `StatusesUi.test.tsx` 9b-7 |
| 8 | Reset panel: parent-set error with Retry | `StatusesUi.test.tsx` 9b-8 |
| 9 | Automations and status files use tokens only | `tokens-only.test.ts` (slice 9b block) |

Existing tests keep covering the builder payloads, optimistic toggle, run history content and the status editor
(`AutomationsPage.test.tsx`, `StatusesDialog.test.tsx`). `e2e/theme-screens.spec.ts` gains the rule builder, rule
card, run history, status manager and status editor in both themes (axe contrast on each).

## Bundle size
See the slice report: the figure is brought to JT Francisco before any change to `bundle-budget.json`.
