# Slice 8 report: the Calendar

Slice 8 changes `frontend/` and `docs/ui/` only: no API, no schema, no backend file, no new dependency.

## What changed
- **Toolbar.** Previous and Next are library `IconButton`s (chevron icons, tooltip, `aria-label`), Today a `Button`, the
  month title in the display font, Month and Week a pair of `aria-pressed` buttons (the active one `primary`). No native
  `<select>`.
- **Grid.** Day cells on `surface` / `surface-2` (days outside the month), 1 px `line` gaps, today's number in an accent
  disc (`aria-current="date"`), the drop target ringed with `accent-line`. No raw palette classes remain in the touched files.
- **Chips.** Status dot in the List's status colour (`role="img"`, named by the status), title link, `PriorityValue`
  badge, Blocked badge. The chip `<li>` is the focusable, draggable element; it shows the focus ring and a lifted style
  while dragged.
- **States.** Loading: "Loading the Calendar" status with skeletons, toolbar and grid already drawn. Error: library
  `ErrorState` with Retry (refetch). Empty range: `EmptyState` "No tasks due in this range." The undated-task count stays.
- **Unchanged behaviour.** UTC days (CAL-1, `calendarGrid.ts` untouched), dnd-kit pointer drag and keyboard drag
  (Left/Right a day, Up/Down a week), `If-Match`, rollback and toast on 409 and 400, "+N more" / "Show less", mode and
  anchor in the URL, the shared `ChipBar` (rendered by `ViewPage`).

## Tests
`CalendarView.test.tsx`: 14 cases (8 new): chip status colour/priority/Blocked, toolbar and title, "+N more" toggle,
loading, error with Retry, empty range, keyboard Down moves a week.

## Bundle size
After `npm run build`, `bash scripts/bundle-size.sh --check`: **446.0 KiB** of the 446.3 KiB cap (slice 7 ended at
445.7, +0.3). Cap and `bundle-budget.json` unchanged.

## Not measured here
Light/Dark screenshots (`theme-screens.spec.ts`), axe contrast and the full verification command: left to the verify
session.
