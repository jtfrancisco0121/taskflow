# Slice 4 report: the List view

Slice 4 changes `frontend/` and `docs/ui/` only: no API, no schema, no backend file, no new dependency. It rebuilds the
List on tokens and the library: dense 36px rows, popover editors, one chip bar for filter, group and sort, a save bar that
compares with the saved view, a bulk bar and keyboard trash that share one trash-with-undo path, row keys, and a `?`
shortcut sheet behind one shortcut guard. `FilterBuilder` and `FilterInput` moved onto library controls, so the
native-select lint exception is gone.

## What changed
- **Library (S1).** `Picker` (a `Popover` around an inline cmdk list; single and multi; an item is named by its label even
  when it shows a hint), `isShortcutBlocked` (the one guard for Cmd/Ctrl+K, row keys and `?`), and toast actions
  (`action`, `durationMs`, `update(id, patch)`). The select helpers in `src/test/ui.ts` and `e2e/ui.ts` reuse an already open
  popup, so two `pick()` calls in a row on a multi Picker both land.
- **Menu inside a Dialog (S2).** `DropdownMenu` gives focus back to its trigger when the trigger sits in the topmost modal
  Dialog and the pick opened nothing above it; a pick that opens a Dialog still moves focus into it. `/design` shows both.
- **Filter builder (S3).** `FilterBuilder` and `FilterInput` use `Select`, `Picker` (built-in priority, status, assignee values)
  and `Checkbox`. Custom option and people values stay an inline `group "Filter value"` of checkboxes, so `fields-filters`,
  `fields-people` and `dependencies` pass unchanged. The ESLint exception is removed and `eslint-boundaries.test.ts` asserts a
  `<select>` is rejected in both files.
- **Chip bar and save bar (S4).** `ChipBar` replaces `ViewToolbar`: "Filter (n)" toggles the panel, one chip per top-level
  condition ("Priority is any of Urgent"), a nested group chip, group and sort chips, every change through `update()` (URL push,
  Back undoes it). `isDirty(base, state)` compares the effective config with the saved one after normalisation (no filter =
  empty AND group, group `none`, sort `manual asc`, Calendar `mode` missing = `month`); the Calendar day `d` never counts, the
  mode does.
- **List rows and editors (S5).** 36px rows on tokens; status, priority, assignee and due are `Picker` popovers
  (`ListEditors.tsx`) controlled by `openEditor` in the view store; the assignee editor keeps a pending selection so quick
  toggles queued behind a slow patch cannot drop each other; due quick picks Today, Tomorrow, Next week, No date plus a day
  field, sent as `YYYY-MM-DDT00:00:00Z`; loading, empty, no-match and error use `Skeleton`, `EmptyState`, `ErrorState`.
- **Keys and one trash path (S6).** `useTrashTasks` is the only caller of `DELETE /tasks/:id` and `POST /tasks/:id/restore`
  in the views feature: `If-Match` versions, six in flight, one "Moved n task(s) to trash." toast with Undo (10 s), trashes
  inside the window merge into that toast, a subtask whose parent is also selected is not sent, restores run ancestors first.
  `useListKeys`: j/k/arrows, x, Enter (only when the row itself has focus), s/p/a/d, Backspace/Delete (ignored while repeating
  or while a trash is in flight), Escape. Rows are a roving tab stop with `aria-selected`.
- **Shortcut sheet (S7).** `SHORTCUTS` lists every key; `?` opens the sheet; a Vitest fails when a key handled by the List,
  the palette shortcut or the search box is missing from it.
- **Evidence (S8).** `snap()` returns the PNG; `theme-screens.spec.ts` opens the workspace switcher before the shell shot and
  asserts it differs from the List shot, and adds the status editor, chip bar, bulk bar and shortcut sheet shots, each with an
  axe `color-contrast` scan in both themes and both OS schemes.

## Bundle size
`bash scripts/bundle-size.sh --check` after each story (fresh `npm run build`). Slice 3 ended at 433.8 KiB (433.7 KiB in
its report).

| After | JS/CSS (gzip -9) | Delta |
|---|---|---|
| Slice 3 | 433.8 KiB | |
| S1 Picker, guard, toast action | 434.1 KiB | +0.3 |
| S2 Menu focus in a Dialog | 434.1 KiB | +0.0 |
| S3 Filter builder on library controls | 435.9 KiB | +1.8 |
| S4 Chip bar, save bar | 437.1 KiB | +1.2 |
| S5 List rows and editors | 439.4 KiB | +2.3 |
| S6 Keys, trash path, bulk bar | 440.6 KiB | +1.2 |
| S7 Shortcut sheet | 441.1 KiB | +0.5 |
| S8 Evidence (specs and docs only) | 441.1 KiB | +0.0 |

Result: `bundle-size: ok`, **441.1 of 446.3 KiB**, 5.2 KiB left; +7.3 KiB over slice 3. Fonts (raw, not in the cap) 289.0 KiB.
`frontend/bundle-budget.json` is unchanged; nothing was re-baselined.

## Contrast
axe `color-contrast`, zero violations, in Light and Aurora and under both OS schemes: the List with the status editor open,
the chip bar with the save bar, the bulk bar, the shortcut sheet, the shell with the workspace switcher open, and every
slice-3 screen. No token changed.

## Screenshots (before | after)
`bash scripts/e2e-local.sh e2e/theme-screens.spec.ts` (theme seeded through `taskflow:theme`).

| Screen | Light | Dark (Aurora) |
|---|---|---|
| List, before (slice 3) | ![before light](slice-4/before-list-light.png) | ![before dark](slice-4/before-list-dark.png) |
| List, after | ![list light](slice-4/list-light.png) | ![list dark](slice-4/list-dark.png) |
| Status editor open | ![editor light](slice-4/list-editor-light.png) | ![editor dark](slice-4/list-editor-dark.png) |
| Chip bar and save bar | ![chip bar light](slice-4/chip-bar-light.png) | ![chip bar dark](slice-4/chip-bar-dark.png) |
| Bulk bar | ![bulk bar light](slice-4/bulk-bar-light.png) | ![bulk bar dark](slice-4/bulk-bar-dark.png) |
| Shortcut sheet | ![shortcuts light](slice-4/shortcuts-light.png) | ![shortcuts dark](slice-4/shortcuts-dark.png) |
| Shell (workspace switcher open) | ![shell light](slice-4/shell-light.png) | ![shell dark](slice-4/shell-dark.png) |

## Carry-overs from slice 3
| Carry-over | Status |
|---|---|
| "Shell (sidebar open)" shots identical to the List shots | Fixed: real shell shots (workspace switcher open), `cmp` reports a difference for both themes, the spec asserts it, `slice-3.md` updated |
| A `DropdownMenu` inside a `Dialog` sends focus to the Dialog's first field | Fixed in `DropdownMenu`; `e2e/design.spec.ts` proves Escape and a no-op pick return focus to the trigger and a pick that opens a Dialog still enters it |
| FilterBuilder / FilterInput native-select exception | Removed; no native select is left in product code |

## Legacy bridge
`legacy-bridge.css` was checked with the dead-entry scan (`legacy-bridge-usage.test.ts`) after the last story: no entry became
dead (every entry the List files used is still used by a later-slice file: the Table, Board, Calendar, task panel, fields and
automations). Removed entries: none. The List files now contain zero palette classes (`tokens-only.test.ts` scans
`ViewPage`, `ListRenderer`, `ListEditors`, `ChipBar`, `ViewTabs`, `FilterBuilder`, `FilterInput`, `ColumnsPicker`,
`ResultNotices`, `BulkBar`, `QuickAdd`).

## Native selects
None left. `grep -n "<select" src/features/views/FilterBuilder.tsx src/features/fields/FilterInput.tsx` finds nothing and the
lint rule has no exception.

## Deviations from the UX spine
- A chip click opens the filter panel on that condition (it does not edit in a popover), and the bulk bar shows only with a
  selection (Undo is a toast action): the UX spine wins over CAP-3 and CAP-6.
- Custom option and people filter values stay an inline checkbox group named "Filter value" (not a popover): the existing e2e
  read them that way.
- After a keyboard-opened editor closes, focus is on that cell's trigger (Radix gives it back there), not on the row; row keys
  still act on the row because they find it from the trigger.

## Tests
The full local PR check (secret scan, `gen:api` drift, lint, typecheck, Vitest, build, `check:dist` and its self-test,
bundle check and self-test, `bash scripts/e2e-local.sh`):
- Lint 0 errors (9 warnings, all there before the slice); typecheck clean; `gen:api` leaves `schema.d.ts` unchanged.
- Vitest: 87 files, 585 tests passed.
- Bundle: `ok`, 441.1 of 446.3 KiB; `check:dist` and both self-tests pass.
- e2e (whole suite, warm dev backend): 53 passed, 1 failed per full run. The failing test differed between two full runs
  (`shell.spec.ts` SM-2 palette in one, `fields-values.spec.ts` in the other) and each passed on a repeat
  (`--repeat-each=5` and `--repeat-each=4`); neither touches the List, so this is the known cold-backend/timing flake, not a
  slice regression.
- `BulkActions.test.tsx` "50 tasks, at most 6 requests at once" got a longer wait (8 s, test timeout 20 s) because it flaked
  once the List rows rendered more, under a loaded parallel run.

## Notes
- The saved Default List view groups by status, so the "Group by Status" chip shows on a fresh List; removing it is a
  URL change and shows the save bar, as any change does.
- The overdue state of a due date is exposed to assistive technology as the visually hidden text "overdue" inside the trigger.
