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
- **Unchanged behaviour.** dnd-kit pointer drag and keyboard drag
  (Left/Right a day, Up/Down a week), `If-Match`, rollback and toast on 409 and 400, "+N more" / "Show less", mode and
  anchor in the URL, the shared `ChipBar` (rendered by `ViewPage`).

## Decision: local days (owner, JT Francisco, 2026-11-27), a divergence from CAL-1
CAL-1 and the slice-5..7 Calendar used UTC days. The owner decided the Calendar uses the viewer's LOCAL days.
- `calendarGrid.ts` does all day arithmetic on calendar fields (local `Date` at noon, `setDate`, `setMonth`), never on
  millisecond counts, so DST days (23 or 25 hours) cannot skip or repeat a cell. Today, the default anchor, the title,
  the grid cells and the week start are local.
- **Stored contract unchanged** (ADR 003 decision 4): a drop sends `YYYY-MM-DDT00:00:00Z` for the target local date, and
  an instant at exactly 00:00 UTC names its own day (`dayOfDue`), so a task dropped on Nov 25 shows on Nov 25 again in
  every zone, the same as the panel and the other views (they display due dates with `timeZone: 'UTC'`). Any other
  instant (agent or import) is shown on its local day.
- Not verified: the `dueDate between [start, end]` range sent to the API is still the bare `YYYY-MM-DD` pair; how the
  backend reads those bounds was not opened. A non-midnight instant on the edge of the visible range may fall outside it.

## Tests
`CalendarView.test.tsx` runs the day math in UTC, America/New_York, Asia/Manila and Pacific/Auckland (the test sets
`process.env.TZ`), with DST-change dates (2026-03-08, 2026-11-01), today near midnight UTC and the default month with
no `d` in the URL; the same file passes under `TZ=UTC`, `America/New_York`, `Asia/Manila`, `Pacific/Auckland` from the
shell. The new zone tests fail on the old UTC code (7 of 30 under `TZ=Asia/Manila`).
`CalendarView.test.tsx`: 14 cases (8 new): chip status colour/priority/Blocked, toolbar and title, "+N more" toggle,
loading, error with Retry, empty range, keyboard Down moves a week.

## Bundle size
After `npm run build`, `bash scripts/bundle-size.sh --check`: **446.0 KiB** of the 446.3 KiB cap (slice 7 ended at
445.7, +0.3). Cap and `bundle-budget.json` unchanged.

## Not measured here
Light/Dark screenshots (`theme-screens.spec.ts`), axe contrast and the full verification command: left to the verify
session.
