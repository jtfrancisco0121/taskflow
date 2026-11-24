# 003: Phase 1 frontend

Status: accepted. Context: the Phase 1 web UI over the merged core backend (decision 002). It follows
`docs/architecture.md` and records where it differs or adds detail.

## Decisions

1. **The open task is a route, not Zustand state.** `docs/architecture.md` section 10 lists "the open
   task" among Zustand state, but `/t/:taskId` must restore from a pasted link, and a store and the URL
   must never disagree. The Task panel renders over the List view of the Location the user came from
   (router location state), or of the task's home List when opened cold. Zustand holds only the sidebar,
   tree expansion, a "creating a Space" flag and toasts.
2. **Phase 1 feature folders** under `src/features`: `auth`, `workspace`, `locations`, `tasks`,
   `comments`, `statuses` (architecture lists `views`, `fields` and others for later phases). A feature
   is imported only through its `index.ts`, and `src/shared` and `src/api` never import features; ESLint
   enforces both (`no-restricted-imports`, tested in `src/test/eslint-boundaries.test.ts`).
3. **Session.** The access token lives in memory in `src/api/session.ts` only. `refreshSession()` is the
   only caller of `POST /auth/refresh`; concurrent callers share one promise and the call runs inside
   `navigator.locks` when available (the backend revokes the whole session family when a refresh token is
   reused). The auth middleware is inside `createApiClient`, so every client, including test clients, has
   it. On a 401 it retries once with the refreshed token (never the expired one), and a 401 for a request
   sent with an older token than the current one retries without a second refresh.
4. **Dates are sent as UTC midnight.** `startDate` and `dueDate` are `date-time` and bound as `Instant`
   by the API (the architecture convention table says `YYYY-MM-DD`). A picked day is sent as
   `YYYY-MM-DDT00:00:00Z` and displayed with `timeZone: 'UTC'`, so a day never shifts with the browser's
   time zone.
5. **The tree is read without paging.** `GET /workspaces/{id}/tree` has no `cursor` and returns every
   visible child in one page, so it is a plain `useQuery` per open node. Endpoints that do have `cursor`
   (workspaces, members, tasks, comments, activity) use `useInfiniteQuery`. Comments are oldest first
   (`id > cursor`), so "Show more" sits after the last comment.
6. **`GET /tasks` takes exactly one of `locationId` and `workspaceId`.** The List view sends only
   `locationId`; an earlier draft sent both and every list request was refused with 400 (found by the
   Playwright flow, not by the stubbed component tests).
7. **Status editing follows the server's remap contract.** `remap.to` is the target status name. A first
   own set on an inheriting Folder or List sends drafts without ids and a remap for every inherited
   status; a reset remaps every own status; same-name targets are pre-filled and the user is asked only
   about the rest (`features/statuses/buildRemap.ts`).
8. **Backend change in a frontend phase: status remaps are scoped.** A status-set change remapped tasks
   workspace-wide by status id, so a first own set on one List moved the tasks of sibling Lists that
   still inherit the Space set to statuses outside their own effective set. `StatusRemapListener` now
   remaps only in Lists at or under the edited location (`LocationTree.listIdsAtOrUnder`, one ltree
   query per change), as STAT-1 and the `StatusSetChanged` Javadoc describe. No API or contract change.
9. **An e2e job in CI.** Compose infrastructure plus the backend in the `dev` profile plus Playwright
   (Chromium). Chromium and Firefox are enough for development; the `Secure` refresh cookie over
   `http://localhost` may be dropped by Safari and is not addressed.
10. **Accepted for Phase 1 sizes:** one statuses request per distinct List in a Space or Folder view, all
    pages of Workspace members are loaded for pickers, and no list virtualization.
