# Slice 3 report: app shell, command palette, theme switcher

Slice 3 changes `frontend/` only (plus README and this report): no API, no schema, no backend file. It adds a persisted
Theme choice (Light, Aurora, System) applied before first paint, a rebuilt app shell whose main region is the only
scroll area, the Cmd/Ctrl+K command palette, the shell menus on the library, and the slice-2 carry-overs that belong
to the shell.

## What changed
- **Theme store and bootstrap.** `src/shared/theme/theme-store.ts` (Zustand) is the one runtime writer of
  `data-theme`; the choice is stored as `taskflow:theme` (`light`, `dark`, `system`). A classic synchronous inline script in
  `index.html` applies it before the first paint (anything else, a missing key or throwing storage resolves to System).
  `theme-bootstrap.test.ts` runs that script for light, dark, system, missing, garbage and throwing storage and fails if
  its key or values differ from the store's exported constants. `ThemeSwitcher` (group "Theme": Light, Aurora, System)
  replaces the `/design`-only toggle and sits in the sidebar footer.
- **`/` guard.** One `isTypingTarget` helper (`input`, `textarea`, `select`, contenteditable, `[role="combobox"]`, anything
  in `[data-tf-floating]`) now decides whether `/` focuses the search box.
- **Menus on the library.** `DropdownMenu` gained radio items, controlled `open`, `keepOpen`, a header slot and an
  explicit label. The workspace switcher, the tree action menu and the bell (a `Popover`) no longer add document
  listeners (a Vitest greps the three files). Shift+F10 on a tree item still opens its actions and Escape returns focus to the
  tree item. `keepFocusIfMoved` now hands focus to an open modal Dialog when a modal menu had pulled it back to the body.
- **App shell.** Full-height frame: frosted sidebar (workspace switcher, Inbox link with badge "99+", tree, footer with the
  switcher, name and Sign out), top bar (Toggle sidebar, palette trigger, search, bell, Settings), and a `main` that is
  the only scroll container on signed-in routes. On `/t/:id` the route lays out its own columns: the background column
  scrolls inside itself and the panel scrolls on its own, so the window and `main` never scroll.
- **Command palette.** Library `Dialog` (`placement="top"`) around an inline `Command` (controlled search, server-backed
  groups that are never client-filtered, status rows, palette size). Groups: Tasks (the existing search, 2+ characters,
  debounced, 20 hits), Go to, Workspaces, Theme, Actions. Commands are composed only in `src/app/palette` from feature
  `index.ts` exports and the shared route builders. The shortcut does nothing under another modal dialog (so it cannot unmount
  `OneTimeKeyDialog`) or under an open menu, Select or popover (`hasOpenFloatingLayer()`), and is not mounted on `/signin`,
  `/signup` or `/design`.
- **Evidence.** `e2e/theme-screens.spec.ts` seeds the stored choice instead of writing `data-theme`, runs both themes under both
  emulated OS schemes, and adds the shell and the open palette. `e2e/shell.spec.ts` covers persistence, System following the OS,
  the Board overflow, the task panel, the palette flows, the floating-layer guard and the aborted-bundle bootstrap.

## Bundle size
`bash scripts/bundle-size.sh --check` (fresh build):

| Part | Size | Budget |
|---|---|---|
| JS/CSS (sum of gzip -9) | 433.7 KiB | cap 446.3 KiB (388.1 KiB baseline + 15%): passes, +18.3 KiB over slice 2 (415.4 KiB), +11.7% over the baseline |
| Self-hosted fonts (raw `.woff2` and `.woff`) | 289.0 KiB | reported separately, not in the cap |

The delta is within the plan's expectation of about 20 KiB (SM-3): cmdk and the Radix dropdown-menu and popover enter
production for the first time (`/design` was the only user before). The budget file is unchanged. `bash scripts/bundle-size.sh`
without `--check` was not run (it builds the base in a temporary worktree with `npm ci`); the delta above is against the slice-2
figure.

## Contrast
axe `color-contrast`, zero violations: the shell and the open palette in Light, Aurora and System-dark (plus every screen
from slice 2 in both themes, now under both OS schemes), and the RuleBuilder with an open Select in both themes (the theme is
chosen through the real switcher). No token changed. Dead `legacy-bridge.css` entries removed: `slate-800`, `red-600`,
`emerald-100`, `emerald-800` (a new Vitest fails when an entry maps a class no source uses; it counts `divide-`,
`placeholder:`, `ring-offset-`, opacity suffixes and `--color-` forms as use).

## Screenshots (light | dark | before, slice 2)
`bash scripts/e2e-local.sh e2e/theme-screens.spec.ts e2e/design.spec.ts` writes them to `artifacts/screenshots/` (the
dark-OS reruns carry an `-osdark` suffix); the set below is committed. Full-page shots now equal the window height (FR-16): the
shell fills the window, so nothing extends past the sidebar and the top bar.

| Screen | Light | Dark (Aurora) | Before (slice 2) |
|---|---|---|---|
| Shell (sidebar open, workspace switcher open) | ![Shell (sidebar open) light](slice-3/shell-light.png) | ![Shell (sidebar open) dark](slice-3/shell-dark.png) | [before](slice-2/list-light.png) / [before dark](slice-2/list-dark.png) (the slice-2 shell around the List) |
| List view | ![List view light](slice-3/list-light.png) | ![List view dark](slice-3/list-dark.png) | [before](slice-2/list-light.png) / [before dark](slice-2/list-dark.png) |
| Open command palette | ![Open command palette light](slice-3/palette-light.png) | ![Open command palette dark](slice-3/palette-dark.png) | new in slice 3 |
| Task panel | ![Task panel light](slice-3/task-panel-light.png) | ![Task panel dark](slice-3/task-panel-dark.png) | [before](slice-2/task-panel-light.png) / [before dark](slice-2/task-panel-dark.png) |
| Board | ![Board light](slice-3/board-light.png) | ![Board dark](slice-3/board-dark.png) | [before](slice-2/board-light.png) / [before dark](slice-2/board-dark.png) |
| Table | ![Table light](slice-3/table-light.png) | ![Table dark](slice-3/table-dark.png) | [before](slice-2/table-light.png) / [before dark](slice-2/table-dark.png) |
| Calendar | ![Calendar light](slice-3/calendar-light.png) | ![Calendar dark](slice-3/calendar-dark.png) | [before](slice-2/calendar-light.png) / [before dark](slice-2/calendar-dark.png) |
| Automations | ![Automations light](slice-3/automations-light.png) | ![Automations dark](slice-3/automations-dark.png) | [before](slice-2/automations-light.png) / [before dark](slice-2/automations-dark.png) |
| Inbox | ![Inbox light](slice-3/inbox-light.png) | ![Inbox dark](slice-3/inbox-dark.png) | [before](slice-2/inbox-light.png) / [before dark](slice-2/inbox-dark.png) |
| Service accounts | ![Service accounts light](slice-3/service-accounts-light.png) | ![Service accounts dark](slice-3/service-accounts-dark.png) | [before](slice-2/service-accounts-light.png) / [before dark](slice-2/service-accounts-dark.png) |
| /design | ![/design light](slice-3/design-light.png) | ![/design dark](slice-3/design-dark.png) | [before](slice-2/design-light.png) / [before dark](slice-2/design-dark.png) |

The two Shell shots were recaptured in slice 4: the originals were byte-identical to the List shots (the shot ran right
after the List shot with no state change). They now show the shell with the workspace switcher open, and
`e2e/theme-screens.spec.ts` asserts that each shell shot differs from the List shot. The List inside them is the slice-4 List.

## Slice-2 carry-overs
| Carry-over | Status |
|---|---|
| Board and other wide screens overflow the viewport | Fixed: `main` is the only scroll container, a wide Board scrolls inside the shell (`e2e/shell.spec.ts`) |
| `/` ignores the library Select | Done: `isTypingTarget` |
| Theme switcher and its persistence | Done: store, bootstrap, `ThemeSwitcher` |
| `theme-screens.spec` depends on the OS / writes `data-theme` | Done: it seeds `taskflow:theme` once per tab; a Vitest bans `data-theme` writes outside `design.spec.ts` |
| Hand-made menus move to the library | Partly: the workspace switcher, tree action menu and bell are on the library; screen menus and the custom `Dialog` stay with the slice that rebuilds each screen |
| Fonts: woff2 only | Not in this slice (Phase 4 backlog) |

## Notes
- Ctrl+K also toggles the palette on macOS, where it overrides the text-field "kill to end of line" binding (PRD FR-5).
- There is no Content-Security-Policy today, so the inline bootstrap is allowed. A future CSP needs a hash for that script.
- The sidebar shows and hides without animation (EXPERIENCE: no animation), so no motion token is used for it.
- Running the e2e suite against a cold backend can lose a just-added task from the List (the view query races the write);
  a warm backend (the second run on) is stable.
- `/design` keeps its menu example; the radio and server-group behaviour is covered by Vitest and shown by a second Command
  block there.
