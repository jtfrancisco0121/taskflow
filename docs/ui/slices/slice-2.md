# Slice 2 report: tokens, Light and Aurora themes, component library, /design and the select migration

Slice 2 changes `frontend/` only: no API, no schema, no backend file. It adds one token source with two real
themes (Light and Aurora) plus System, a temporary legacy palette bridge so unrebuilt screens follow the theme,
self-hosted fonts, an owned Radix/cmdk component library in `src/shared/ui`, a development-only `/design` page, the
replacement of the product native selects, a bundle gate, and the slice-1 carry-overs.

Owner decisions applied: themes are Light, Aurora (the only dark theme) and System (the app follows the OS colour
scheme from this slice on; the user switcher and its persistence are slice 3); every text/background pair meets 4.5:1
and a failure is fixed in the token, not in a component; no "Dark base"; hard bundle cap of +15% over 388.1 KiB.

## Bundle size
`bash scripts/bundle-size.sh --check` (fresh build): 

| Part | Size | Budget |
|---|---|---|
| JS/CSS (sum of gzip -9) | 415.4 KiB | cap 446.3 KiB (388.1 KiB baseline + 15%): passes, +27.3 KiB (+7.0%) |
| Self-hosted fonts (raw `.woff2` and `.woff`, 14 files) | 289.0 KiB | reported separately, not in the cap |

CI and the PR check run `--check` after the build; `bash scripts/bundle-size.sh --self-test` proves it fails with the
baseline lowered. Fontsource's per-weight stylesheet ships a `.woff` fallback next to each `.woff2`, so the font figure
is about twice what a woff2-only build needs (see the Phase 4 backlog).

## Native-select exceptions
Nothing else stays on a native select. The named exceptions, each carrying a `TODO(slice 4)` comment and excluded from
the ESLint rule that rejects a native `<select>` in `src/**/*.tsx`:

- `frontend/src/features/views/FilterBuilder.tsx` (4 selects: match, field, operator, value), until the List view chip
  bar rebuilds the filter UI in slice 4.
- `frontend/src/features/fields/FilterInput.tsx` (1 select, the relative-date picker; it renders only inside
  FilterBuilder).

Test fixtures in `*.test.tsx` and `src/test/**` keep `<select>` on purpose (they prove the helper's native path).
The slice-1 line "All 41 product `<select>` elements stay native until their own slices (4 to 9)" is superseded: 36 of
the 41 are replaced here by the library `Select`, in 11 files (RuleBuilder 16, FieldEditor 4, ViewToolbar 3, BulkBar 3,
TaskFields 2, StatusEditor 2, ViewTabs 2, CreateKeyDialog 1, ValueEditor 1, ResetPanel 1, views/cells 1); the remaining
5 are the two files above. Empty-value options were classified: prompts ("Choose a status", "Set priority...") became
the `placeholder` prop and are never listed as options; real choices that store `''` ("Any status", "Any change", "A
specific person (optional)", the field "-") stay as items. Stored values and visible labels are unchanged.

## Contrast
- `frontend/src/shared/theme/contrast.test.ts`: every text token (fg, muted, faint, accent, danger, the four status and
  four priority colours) on every ground (bg, surface, surface-2, surface-3, panel, accent-soft and the four tints) is at
  least 4.5:1 in Light and in Aurora, translucent tokens blended over their ground; accent-fg/accent, primary-fg on both
  gradient stops and danger-fg/danger too; the System-dark block declares exactly the Aurora properties and values;
  `legacy-bridge.css` has no theme selector and no colour literal; and every text/ground palette class pair found in
  `src/features/**` (hover and focus variants included) is checked through the bridge in both themes. 4.5:1 is used even
  for text of 24px and larger, which could use 3:1. Result: all pass.
- axe `color-contrast` (`@axe-core/playwright`), zero violations: `/design` in Light, Aurora and System-dark; the 8
  screens in Light and Aurora; the List in System-dark (no `data-theme`, dark scheme emulated); sign-in and sign-up in
  both themes; the open RuleBuilder dialog with its Trigger select open in both themes; the `/design` toasts (info and
  error) in both themes; the `/design` Dialog with an open Select. The first run found one failure: the Calendar dimmed
  out-of-month days with `opacity-50`, which cannot meet 4.5:1, so those days now use a quieter ground
  (`CalendarRenderer.tsx`).
- Zero requests to `fonts.googleapis.com` or `fonts.gstatic.com` in the e2e runs, and `check:dist` fails if the build
  references them.

## Tokens moved from the prototype (UI-PRD section 3)
Each value was darkened or added so its pair meets 4.5:1. They live in `frontend/src/shared/theme/tokens.css`.

| Token | Prototype | Now | Why |
|---|---|---|---|
| faint (Light) | `#8e89a8` | `#69657c` | placeholder and hint text failed on the lavender surfaces |
| accent (Light) | `#6b4eff` | `#6549f0` | below 4.5:1 as text on accent-soft |
| primary-from / primary-to (Light) | `#4f6bff` / `#8b5cf6` | `#4c67f5` / `#8558ec` | white text on the gradient stops |
| status-todo / progress / review / done (Light) | `#8a9592` / `#2f6fe0` / `#c07a0a` / `#1d9a56` | `#626a68` / `#2a64ca` / `#915c08` / `#167642` | readable as text on the tints |
| priority-urgent / high / normal / low (Light) | `#d63b3b` / `#e0861c` / `#3a78dd` / `#9ba5a2` | `#be3434` / `#965913` / `#3166bc` / `#636a68` | same |
| danger (Light) | `#c93434` | `#c13232` | on danger-soft |
| faint (Aurora) | `#6a7399` | `#8e94b1` | placeholder text on the navy ground |
| status-todo/progress/review/done, priority-urgent/high/normal/low, danger-fg, danger-soft, warn-soft, ok-soft, blue-soft (Aurora) | none | added | the prototype had no dark values; danger-fg is dark because white on `#ff7a8a` fails |

## React 19.3 and Radix / cmdk
`npm ci` and `npm install` ran with no `--legacy-peer-deps` and no override; `npm ls react` reports no invalid peer for
any package. Installed: `@radix-ui/react-select` 2.4.1, `-popover` 1.3.1, `-dropdown-menu` 2.2.1, `-tooltip` 1.4.1,
`-switch` 1.4.1, `-checkbox` 1.4.1, `cmdk` 1.1.1 (all peers include `^19`), with react 19.3.1. Slice-1 carry-over 4 is
resolved: nothing blocks the work.

## Carry-overs from slice 1
1. `e2e/automations.spec.ts`: both the PATCH and the refetch of the rule list are awaited before Edit (5 consecutive
   runs, no 409).
2. Both `ui.ts` helpers: `optionsOf` leaves out the native placeholder and disabled options, matching `pick({ index })`
   and the Radix path (placeholder is on the trigger, sentinel `''` items count, `aria-disabled` items do not).
3. `src/test/ui.ts` `close()` waits for the popup its own `open()` returned (Vitest case with another listbox open).
4. Radix and cmdk accept React 19.3 (above).
5. The helpers' Radix path runs against the real library `Select` in Vitest (`src/test/ui.test.tsx`) and on `/design` in
   Playwright (`e2e/ui.spec.ts`), with native-versus-library parity and sentinel cases.
   A helper change was needed along the way: `e2e/ui.ts` `open()` now holds the trigger element, because a locator that
   finds the trigger by its `<label>` stops resolving while Radix marks the page behind an open listbox `aria-hidden`.

## Screenshots (light | dark)
Regenerate with `bash scripts/e2e-local.sh e2e/theme-screens.spec.ts e2e/design.spec.ts`; they land in
`artifacts/screenshots/` (git-ignored) and the set below is committed here. The two themes now really differ: every
light/dark pair below is a different file (checked byte-for-byte).

| Screen | Light | Dark (Aurora) |
|---|---|---|
| List view | ![List view light](slice-2/list-light.png) | ![List view dark](slice-2/list-dark.png) |
| Task panel | ![Task panel light](slice-2/task-panel-light.png) | ![Task panel dark](slice-2/task-panel-dark.png) |
| Board | ![Board light](slice-2/board-light.png) | ![Board dark](slice-2/board-dark.png) |
| Table | ![Table light](slice-2/table-light.png) | ![Table dark](slice-2/table-dark.png) |
| Calendar | ![Calendar light](slice-2/calendar-light.png) | ![Calendar dark](slice-2/calendar-dark.png) |
| Automations | ![Automations light](slice-2/automations-light.png) | ![Automations dark](slice-2/automations-dark.png) |
| Inbox | ![Inbox light](slice-2/inbox-light.png) | ![Inbox dark](slice-2/inbox-dark.png) |
| Service accounts | ![Service accounts light](slice-2/service-accounts-light.png) | ![Service accounts dark](slice-2/service-accounts-dark.png) |
| /design | ![Design light](slice-2/design-light.png) | ![Design dark](slice-2/design-dark.png) |

The unrebuilt screens look like the old layout in new colours: the legacy bridge (`legacy-bridge.css`) points their
raw palette classes at the tokens. It is temporary, one-way and theme-free, and each screen's own slice removes its
entries.

## Phase 4 backlog / follow-ups
- Fonts: ship woff2 only (write the `@font-face` rules instead of importing Fontsource's per-weight stylesheets), which
  roughly halves the 289 KiB font weight.
- Board (and other wide screens) overflow the viewport horizontally, so the shell header and sidebar end before the
  scroll width in a full-page screenshot. It predates this slice; the screen's own slice should fix the shell layout.
- Saving a rule shows no success toast today, so the toast contrast is scanned on `/design` (info and error) instead of
  after saving a rule.
- The custom `Dialog`, the hand-made switches in RuleCard and NotificationSettings, and the other hand-made menus move to
  the library in the slice that rebuilds each screen.
- GitHub Actions does not run (billing): the local PR check is the real gate.
