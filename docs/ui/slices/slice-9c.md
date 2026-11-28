# Slice 9c report: agent access (service accounts, keys, revoke, MCP setup)

Slice 9c (the last subtask of slice 9; 9a was notifications and fields, 9b automations and statuses) changes
`frontend/` and `docs/ui/` only: no API, no schema, no backend file, no new dependency. The key format, its storage
and the one-time reveal are unchanged. Risk: high (access and keys).

## Design note
- **Service accounts** (`ServiceAccountsPage`): loading is a "Loading service accounts" status with `Skeleton` rows;
  a failed load is an `ErrorState` with Retry; none is an `EmptyState` ("No service accounts yet"). The table, the
  Disabled pill and the account links use tokens. A 403 still shows the owners-and-admins copy and no actions.
- **Account page** (`ServiceAccountDetailPage`): a "Loading service account" status with skeletons, an `ErrorState`
  with Retry for a failed load, the disabled banner on `warn-soft`. The Keys and Audit tabs follow the WAI-ARIA tabs
  pattern: one tab stop, ArrowLeft and ArrowRight (wrapping), Home and End move and select.
- **Keys** (`KeysTab`): a new **MCP setup** panel shows the MCP URL with a Copy button (announced "URL copied"), the
  transport (Streamable HTTP) and the header `Authorization: Bearer <key>` with a placeholder. The panel never holds
  a key. Keys show skeletons, `ErrorState` with Retry, `EmptyState` ("No keys yet"); the status is a soft token pill.
- **One-time key** (`OneTimeKeyDialog`): unchanged behaviour (shown once, Escape and the backdrop do nothing, Copy, the
  one way out is "I have copied the key", after which the secret is dropped). The key element carries `data-secret`,
  and `e2e/screenshots.ts` masks `[data-secret]`, so no screenshot can carry a key. The warning is on `warn-soft`.
- **Revoke and disable** keep the library `Dialog` confirm with Cancel focused first; Escape cancels.
- **Audit** (`AuditTab`): "Loading calls" and "Loading changes" statuses with skeletons, an `ErrorState` with Retry
  for each, `EmptyState`s for no calls and no changes, the per-day bars on `surface-2` and `accent`.

## Acceptance criteria and their tests
| # | Criterion | Test |
|---|---|---|
| 1 | Accounts list: skeleton loading status, empty state, error with Retry that reloads | `AgentAccessUi.test.tsx` 9c-1 |
| 2 | Account page: skeleton loading status, failed load with Retry that reloads | `AgentAccessUi.test.tsx` 9c-2 |
| 3 | Keys and Audit tabs: arrow keys, Home and End, one tab stop | `AgentAccessUi.test.tsx` 9c-3 |
| 4 | Keys tab: skeleton loading status, empty state, error with Retry that reloads | `AgentAccessUi.test.tsx` 9c-4 |
| 5 | MCP setup: URL, transport and header shown; Copy copies the URL and is announced; no key material | `AgentAccessUi.test.tsx` 9c-5 |
| 6 | A new key is shown exactly once; never in storage, the query or mutation cache, the console or a screenshot | `AgentAccessUi.test.tsx` 9c-6 |
| 7 | A member opening an account URL sees the 403 copy, no keys, no Create key, and no key request is made | `AgentAccessUi.test.tsx` 9c-7 |
| 8 | Audit tab: loading statuses, empty states, errors with Retry for calls and changes | `AgentAccessUi.test.tsx` 9c-8 |
| 9 | Revoke confirm: Escape cancels with no request; keyboard Tab and Enter revoke | `AgentAccessUi.test.tsx` 9c-9 |
| 10 | Every `features/serviceAccounts/*.tsx` file uses tokens only | `tokens-only.test.ts` (slice 9c block) |

9c-7 and 9c-9 passed before the change: they pin access and confirm behaviour that the restyle must not lose.
Existing tests keep covering create, the 409 name clash, disable and enable, the one-time dialog, Copy, a past expiry,
revoke, the audit content, restore and the refresh notices (`ServiceAccountsPage.test.tsx`, `KeysTab.test.tsx`,
`AuditTab.test.tsx`, `firstLoadRace.test.tsx`); their empty-state checks now read the `EmptyState` headings.
`e2e/theme-screens.spec.ts` adds, in both themes with axe contrast on each: the empty keys tab with MCP setup
(`sa-keys-empty`), the one-time key dialog with the key masked (`sa-one-time-key`), the keys table (`sa-keys`), the
revoke confirm (`sa-revoke`) and the audit tab reached by the arrow key (`sa-audit`).

## Legacy bridge
`src/shared/theme/legacy-bridge.css` stays: slice 9c removes its last users under `features/serviceAccounts`, but
these files outside slice 9's scope still use bridged palette classes: `features/auth/SignInPage.tsx`,
`features/auth/SignUpPage.tsx`, `features/locations/LocationIcon.tsx`, `features/locations/MoveDialog.tsx`,
`features/locations/WorkspaceHomePage.tsx`, `features/workspace/SetupPage.tsx`,
`features/workspace/WorkspaceRedirect.tsx`, `shared/richtext/RichTextEditor.tsx`, `shared/richtext/mentionSuggestion.ts`.

## Native controls
None left in the touched files (the expiry picker was already the library `Select`).

## Bundle size
`bash scripts/bundle-size.sh` against the merge-base with main (d40b7b2): JS/CSS gzip **451.0 KiB -> 451.4 KiB
(+0.4 KiB)**; fonts unchanged at 289.0 KiB. `bash scripts/bundle-size.sh --check`: within the approved 550 KiB cap
(`bundle-budget.json`, JT Francisco 2026-11-27), so no new cap is proposed.
