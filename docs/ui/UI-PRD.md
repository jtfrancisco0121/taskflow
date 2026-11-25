# Taskflow UI Overhaul (Phase 3.5): spec

Status: approved direction. Applies after Phase 3 is merged and before Phase 4 starts.

Visual and interaction reference: the "Taskflow UI Overhaul" prototype (https://claude.ai/artifact/2Zyt9JLe8RuHq33esjrwNv).
If `docs/ui/ui-overhaul-prototype.html` exists in the repo, read it. If it does not, use the token table below, which is
copied from the prototype's CSS variables, and ask the owner for anything else you need. Do not copy prototype code.

## 1. Goal
Make Taskflow feel like a dense, fast, keyboard-first work tool, good enough to screenshot for a portfolio.
Behavior stays the same; look, structure and UX change. Phases 4-5 are built on top of this UI.

## 2. Look and themes
- Dark theme: "Aurora glass, Midnight palette": navy-black ground, frosted panels, indigo and electric-blue glow.
- Light theme: REQUIRED. Ships together with dark.
- Theme switcher: three options (Light, Dark, System). Default is System. The choice persists per browser
  (localStorage, wrapped in try/catch) and is applied before first paint to avoid a flash. The switcher lives in the sidebar
  footer and as a command in the Cmd+K palette.
- The prototype defines the glass look for dark only. The planner proposes a light counterpart (frosted white panels,
  same accent family) and shows it for approval before building it. Both themes get their own screenshots.
- Fonts: Bricolage Grotesque 600/700 (headings), IBM Plex Sans 400/500/600 (body), IBM Plex Mono 400/500
  (ids, shortcuts). Self-host them (for example via @fontsource). No Google Fonts requests from the app.

## 3. Tokens (from the prototype; the planner may refine, but must justify changes)
Light (default `:root`):
- bg #f7f6fc, surface #ffffff, surface-2 #f4f2fb, surface-3 #e9e6f6
- line #e4e1f0, line-strong #cdc8e1
- fg #1b1830, muted #5d5878, faint #8e89a8
- accent #6b4eff, accent-fg #ffffff, accent-soft #eeeaff, accent-line #c4b8ff
- status: todo #8a9592, in progress #2f6fe0, review #c07a0a, done #1d9a56
- priority: urgent #d63b3b, high #e0861c, normal #3a78dd, low #9ba5a2
- danger #c93434 (soft #fbe5e3), warn-soft #fdf0d9, ok-soft #dcf2e4, blue-soft #e2ebfb

Dark base:
- bg #0f0d19, surface #171428, surface-2 #1e1a33, surface-3 #28233f
- line #2c2745, line-strong #3e3762
- fg #ebe8f8, muted #a6a0c4, faint #736d93
- accent #9583ff, accent-fg #140d36, accent-soft #2a2352, accent-line #4d41a0
- status: todo #8d9a97, in progress #5c93f0, review #e2a23c, done #3cc47a
- priority: urgent #f06363, high #f0a246, normal #6a9cf0, low #7e8a87
- danger #f06363 (soft #3a1c1c), warn-soft #3a2c12, ok-soft #133523, blue-soft #1a2944

Aurora overlay on top of dark:
- bg #060914, surface #0e1428, surface-2 rgba(255,255,255,.045), surface-3 rgba(255,255,255,.09)
- line rgba(255,255,255,.08), line-strong rgba(255,255,255,.18)
- fg #e9edff, muted #9ba5ca, faint #6a7399
- accent #8d9bff, accent-fg #0a0f2c, accent-soft rgba(110,128,255,.17), accent-line rgba(141,155,255,.5)
- in progress #5cb6ff, review #ffb44d, done #3ddc97, danger #ff7a8a
- primary button gradient: 135deg, #4f6bff to #8b5cf6
- ground glows: indigo rgba(79,70,229,.48) top-left, blue rgba(37,99,235,.34) bottom-right, violet rgba(139,92,246,.20) top-right
- floating panels (modals, popovers, palette): rgba(15,21,44,.78), blur 20px, saturate 150%

Layout reference: sidebar 236px, task modal up to 940px with a 330px activity column, docked task panel 600px,
board column 268px, base text 13-14px, row height about 36px.

## 4. Stack rules
Radix UI primitives + Tailwind driven by the tokens (shadcn-style, components owned in the repo).
Keep TanStack Query/Table/Virtual, dnd-kit, Tiptap, React Hook Form + Zod. No heavier UI kit.

## 5. In scope (must be backed by the existing API)
- Design system: tokens, component set, and a dev-only /design route showing every component in every state, in both themes.
- App shell: collapsible workspace tree (Space > Folder > List), inbox badge, Cmd+K command palette, theme switcher.
- List, Board, Table and Calendar views. Popover editors for status, priority, assignee and due date (with quick picks).
  One chip bar for filter, group and sort. A save bar that appears only when the view has changed. Bulk actions bar.
- Task detail (modal and docked), custom fields with "from <level>" labels, dependencies, activity feed with agent and automation tags.
- Phase 3 screens: field manager, automation builder and run history, notification inbox,
  agent access (service accounts, keys shown once, revoke, MCP setup).
- Keyboard: j/k move, x select, Enter open, s/p/a/d edit status/priority/assignee/due, Backspace trash with undo toast,
  ? opens the shortcut sheet.
- Every screen has loading, empty and error states.

## 6. Needs confirmation before building
List an effort estimate for each and wait for the owner's answer. Build only if the API supports it or a backend change is approved:
- PR and link previews in comments (implies a GitHub integration that is not in the PRD)
- Threaded replies in comments
- Subtasks and checklists in the task detail
- Trash view and undo
- Status manager (edit workflow statuses per list)
- Presence indicators ("simulate a teammate's edit" in the prototype)

## 7. Out of scope
Layouts below tablet width, Phase 4-5 features, any API or schema change without a decision record.

## 8. Order of work
1. Test helper that abstracts select and popover interactions, so existing Playwright tests survive. The current UI has
   about 13 components using native selects and about 57 test calls tied to them.
2. Tokens, component library and the /design route, in both themes.
3. App shell, command palette and theme switcher.
4. One screen per slice: list, task detail, board, table, calendar, then the Phase 3 screens.
5. Portfolio polish: seeded demo workspace, README screenshots in both themes, a short demo script.

## 9. Acceptance (every slice)
- Existing Playwright tests pass. New tests cover the main flows, the keyboard paths and the theme switcher.
- Text contrast at least 4.5:1 in both themes (3:1 for text 24px and larger). Visible focus. Everything keyboard reachable. aria-labels on icon-only buttons.
- backdrop-filter only on the shell, modals and popovers, not on list rows or cards.
- Respects prefers-reduced-motion.
- Before and after screenshots in both themes, and the bundle-size change, in the slice report.
- One PR per slice, app working after each. gitleaks clean.
