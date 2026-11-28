# 010: A refresh token whose rotation response was lost

Status: accepted. Decided by JT Francisco, 2026-11-28: option (b), the same successor for 30 s, the key derived
from the JWT secret. Context: ClickUp
14yq6g334jy. A page reload aborts an in-flight `POST /api/v1/auth/refresh` after the server has rotated the
refresh token. The browser never processes the `Set-Cookie`, keeps the old token, and the reloaded page's boot
refresh presents it. `AuthService.refresh` treats any spent token as theft and revokes the whole family, so the
user is signed out. Seen 1 in 120 e2e runs at workers=4 (theme-screens System test). In the trace
`artifacts/e2e-failures/auth-refresh-race-20261127-235117` the aborted refresh starts at 15:49:02.477Z and is
cancelled after 599 ms; the next boot refresh starts at 15:49:04.168Z, 1.7 s later, and gets 401.

## How it worked before this decision

Line references in this section are at main@5ebc520, before the change; the code has moved since.

- Rotation: a refresh selects the token row, marks it `rotated_at = now()` only if it is neither rotated nor
  revoked, and inserts a new random token in the same family, all in one transaction
  (`AuthService.java:131-176`, insert at `:203-216`). Any spent, expired or lost-the-race token revokes every
  token in the family (`:149-159`, `revokeFamily` at `:197-201`).
- Storage: `refresh_token` keeps only the SHA-256 of each token (`token_hash text NOT NULL UNIQUE`), with
  `family_id`, `expires_at`, `rotated_at`, `revoked_at`; nothing links a token to its successor and nothing
  identifies the client (no user agent, IP or device key) (`V202611241100__identity_users_tokens.sql:12-21`).
- Lifetimes: access token 15 minutes, refresh token 30 days (`JwtProperties.java:12-13`).
- Cookie: `refresh_token`, HttpOnly, Secure, SameSite=Strict, Path `/api/v1/auth` (`AuthController.java:106-113`,
  decision 002.7). Script cannot read it, so stealing it takes the device, a proxy log or malware, not XSS.
- Client: `refreshSession()` is the only caller; callers in one tab share one promise and the call runs inside
  `navigator.locks.request('taskflow-refresh', ...)` so tabs take turns (`frontend/src/api/session.ts:85-100`,
  decision 003.3). The app boot refreshes on every page load (`frontend/src/api/client.ts:54`), and any 401
  refreshes once (`client.ts:19-44`), so every reload rotates the token.
- Concurrency: two requests with the same token cannot both win; the loser sees `rotated == 0` and revokes the
  family (`AuthService.java:149-159`), which is the multi-tab form of the same bug when the lock is absent.

The tests `RefreshReloadRaceIT` (red before the change: 401 where 200 is expected, and `[200, 401]` for two concurrent
refreshes) describe the wanted behaviour. `RefreshReuseGuardIT` (green before the change) pins what must not change: a
token whose successor was used, a token rotated long ago, a signed-out family and an expired token all still
fail and revoke.

## Options

**(a) Grace window, re-issue.** The immediate predecessor A, presented within N seconds of its rotation while
its successor B was never used, revokes B and issues a new B' instead of revoking the family.

- Security: adds N seconds after each rotation in which a holder of A gets a live token. Theft is still caught
  when the victim next presents B (revoked, so the family dies), within one access-token lifetime.
- Complexity: needs the A-to-B link (a `successor_id` column and migration, or "newest token of the family").
- Multi-tab: two concurrent refreshes with A get B and B'; whichever `Set-Cookie` the browser processes last
  wins, and if that is the revoked B the next refresh signs the user out. `RefreshReloadRaceIT`'s concurrent
  test fails by design under this option.
- Variant without revoking B forks the family into two live branches, which defeats reuse detection. Rejected.

**(b) Idempotent rotation (recommended).** Within the same window and conditions, replaying A returns the same
B (with a fresh access token). B is not stored raw: it is derived, `B = base64url(HMAC-SHA256(k, A))`, so the
server recomputes it from the A it is shown and finds the row by `sha256(B)` on the existing unique index.

- Security: the same N-second widening as (a), no more. Whoever presents A in the window gets B, the token the
  real client also holds. The two then diverge on their next refresh and the second presenter of B, outside
  the window, revokes the family, so detection is delayed, not lost. The database still holds only hashes; the
  derivation key adds nothing an attacker with the JWT signing key couldn't already do (mint access tokens).
- Complexity: small, inside `AuthService.refresh`: take the family lock (see Consequences), lock A's row
  (`FOR UPDATE`), derive B on rotation instead of random bytes; on a rotated A, return B if A is not revoked or expired, was rotated less than N ago, and the
  family's only live token is B (unrevoked, unexpired, never rotated; hashes compared with
  `MessageDigest.isEqual`); otherwise revoke as today. No migration.
- Multi-tab: two concurrent refreshes with A both get the same B (the loser waits on the family lock until the
  winner commits, then finds B), so the cookie jar is right whichever response lands last. Passes both race
  tests.

**(c) Client only.** Keep the refresh alive across a reload (`fetch` `keepalive`, `sendBeacon`, a
BroadcastChannel hand-off, or a longer-held Web Lock).

- Cannot close the race: the server commits the rotation before the response is sent, and a request aborted
  after that commit loses B for good; only the server can recognise A as "just rotated". A Web Lock is
  released when its page unloads, and the reloaded page's boot refresh starts in about a second with the old
  cookie, ahead of any keepalive response. It also does nothing for a closed tab, a dropped mobile connection
  or a killed browser. `sendBeacon` cannot read the response at all.
- Security: none lost. Useful later as a frequency reducer, not as the fix.

**(d) Others considered.**

- Keep A valid until B is first used, with no time limit: widens the theft window from N seconds to the whole
  interval until the next refresh (15 minutes active, up to 30 days idle). Rejected.
- Bind refresh tokens to a device key (DPoP-style, a non-extractable WebCrypto key signing each refresh): the
  strongest theft defence and would make a grace window nearly free, but it is a new protocol, client crypto
  and a migration. A later hardening, not this fix.
- Rotate less often (sliding expiry): reduces how often the race can happen but keeps it, and weakens reuse
  detection. Rejected.

## Recommendation

Option (b) with N = 30 seconds, as `taskflow.jwt.refresh-reuse-grace` (default `PT30S`; `PT0S` restores
today's behaviour). The observed gap between the aborted refresh and the replay is 1.7 s, so 30 s leaves room
for slow devices while adding at most 30 s per rotation to a window a thief already has (about 15 minutes for
an active session, the time until the next refresh). Prior art (from memory, not checked in this session):
Okta's refresh-token rotation grace period and Auth0's reuse interval follow the same idea.

## Consequences

- `TokenIT.refreshRotatesThePairAndReusingTheOldTokenRevokesTheFamily` (`TokenIT.java:57-82`) asserts that A
  presented right after rotation, before B is used, is a 401. That is exactly the case this decision makes a
  200: the server cannot tell "the client lost B" from "someone replays A within 30 s". The fix changes that
  test to replay A after B was used (covered by `RefreshReuseGuardIT`).
- The derivation key is HKDF-SHA256 (RFC 5869, empty salt) of the JWT secret with the label
  `taskflow-refresh-successor-v1`, so production needs no new secret and the key is never the signing key.
  A grace replay derives the successor with the key it runs under, so a replay of A after the JWT secret
  changed mid-grace, or one that reaches an instance with the other secret during a rolling change, does not
  find B as the family's live token: it revokes the family and the user is logged out, as without this
  decision. Rotate the secret when a few sign-outs are acceptable.
- `refresh-reuse-grace` above `PT5M` is refused at startup (`JwtProperties`): a longer window is no longer a
  lost response, it only widens what a thief gets. A bare number is seconds (`TASKFLOW_REFRESH_REUSE_GRACE=30`
  is 30 s, not 30 ms); explicit units such as `PT30S` or `500ms` bind as written.
- Every refresh and sign-out takes a transaction-scoped advisory lock on the token's family
  (`pg_advisory_xact_lock(hashtextextended('refresh_family:' || family_id, 0))`) before any token row lock,
  so requests on one family run one after another. Without it, the token row lock and the family-wide
  statements (the live-successor check, the family revocation) could deadlock, and a sign-out racing a
  rotation could miss the new successor (`RefreshFamilyLockIT`). A token that can never be honoured again
  (revoked, or expired and never rotated) is refused before the lock, and the wait for the lock is bounded
  (see Hardening).
- A grace replay should be logged (family id, no token), so a pattern of replays is visible.

## Accepted risks

Decided by JT Francisco, 2026-11-28, on review of PR #33. Both are accepted as stated, not fixed.

1. **Successors are derivable.** Each successor is the HMAC of the token before it, with a key from the HKDF of the
   JWT secret (`AuthService.java:179` at main@4d2e610, `successors.of(rawToken)`). Whoever holds the JWT secret and one token of a
   family can compute every later token in that chain offline. Accepted because a holder of the JWT secret can
   already sign access tokens for any user, so this adds no capability. Mitigation: treat the JWT secret as the root
   credential and rotate it on suspicion (which signs users out, see Consequences).
2. **Unlimited replays in the grace window.** Inside the grace window a spent token can be replayed any number of
   times (`AuthService.java:189` at main@4d2e610). Each replay returns the same successor and a new access token, nothing is
   revoked, and the only trace is one INFO log line per replay (family id). Accepted because a holder of A inside
   the window could equally have taken B, so replays add no capability; this is the trade-off option (b) makes. A
   louder signal (WARN or a metric) and the related hardening are tracked in ClickUp 14yq6g334r6.

## Hardening (ClickUp 14yq6g334r6, slice 1)

Follow-ups from the PR #33 reviews, after the decision was implemented. All in `AuthService`, `AuthController`,
`JwtProperties` and `ProblemDetailsHandler`.

- **Dead tokens skip the family lock.** A revoked token, or an expired one that was never rotated, gets 401
  without taking the family lock, so flooding `POST /auth/refresh` with one cannot queue requests on the
  family while each holds a pool connection. Both states are final and a token read as live is read again
  under the lock. An expired token that was rotated still takes the lock and revokes its family as reuse; after
  the first such request the family is revoked, so the rest are refused before the lock
  (`RefreshLockContentionIT` for the dead states, `RefreshReuseGuardIT` for the expired, rotated token). One
  gap, up to about the 2 s lock wait wide (`now()` is the transaction's start, taken before the lock wait): a
  rotation that starts before the token expires and commits after leaves a rotated, expired token that a replay
  presents after expiry; if the replay reads the row before that commit, it sees an expired, unrotated token and
  gets 401 without revoking the family. That loses a reuse signal; it does
  not let the replay through.
- **Bounded lock wait.** Refresh and sign-out set a 2 s transaction lock timeout (`LockTimeout.set`, the one
  helper for `SET LOCAL lock_timeout`, slice 2). On refresh, a wait past it (55P03), a deadlock (40P01) or a
  serialization failure (40001) answers 503 with `Retry-After: 1` and code `request.busy` instead of a 500
  (`ProblemDetailsIT`, `RefreshLockContentionIT`). Sign-out does not answer 503 for contention (see slice 2).
- **Sign-out always clears the cookie**, also when revoking the family fails (`AuthControllerSignOutTest`).
- **Sign-out revokes the family on the server**, because the browser has no cookie left to retry with. Slice 1
  retried the locked revoke three times and, if all failed, left the family live until it expired (up to 30
  days), a gap JT Francisco accepted on 2026-11-28 until slice 2. Slice 2 replaces the retry with a
  pending-revocation row; see below.
- **The user is checked before rotation**, so a refused token is never left rotated with no successor
  (`RefreshReuseGuardIT`).
- **Expiry on the database clock.** `expires_at` is set from the database's `now()` and judged against it, the
  same clock as the grace window, so a JVM/database clock skew cannot split the two decisions
  (`RefreshReuseGuardIT`).

## Hardening (ClickUp 14yq6g334r6, slice 2): sign-out always ends the family

- **Pending-revocation row.** Table `refresh_pending_revocation` (`family_id` primary key, `created_at`;
  `V202612040900__identity_refresh_pending_revocation.sql`). Sign-out looks up the token's family; a dead token
  (revoked, or expired and never rotated) has nothing live in its family and returns 204 at once. Otherwise
  sign-out first writes the row with `INSERT ... ON CONFLICT DO NOTHING`, without the family lock (it cannot
  be blocked by the lock), then makes **one** locked revoke attempt with the 2 s lock timeout. Every refresh
  checks the row under the family lock, before any rotation or grace replay; if it is there, the refresh
  revokes the family and answers 401. So sign-out answers 204 whether or not its locked attempt got the lock,
  and the family ends either at sign-out or at the next refresh of any of its tokens, the predecessor in its
  grace window included. Worst case: one access token already issued stays valid until it expires (up to
  `access-ttl`, PT15M); access tokens are not checked against the database. The 3 x 2 s retry, and the
  request thread and pool connection it held for about 6 s, are gone (`RefreshLockContentionIT`,
  `AuthServiceSignOutTest`).
- **Ordering.** A refresh that holds the lock while sign-out writes the row may still rotate (it checked before
  the row existed); its successor is in the family, so sign-out's locked attempt revokes it, or, if that attempt
  times out, the successor's next refresh sees the row. The row is committed before sign-out's locked attempt,
  so every refresh that takes the lock after that attempt sees it.
- **The deliberate flood.** The PR #34 review found that a holder of a stolen live refresh token could keep the
  family lock busy by flooding `POST /auth/refresh`, so that the victim's sign-out failed all its retries and
  the family, the thief's copy included, stayed live for up to 30 days. The row closes this: the flood cannot
  stop the unlocked insert, and the flood's own next refresh that gets the lock sees the row and revokes the
  family (`RefreshLockContentionIT.aRefreshStormDuringSignOutStillEndsWithTheFamilyRevoked`). The thief keeps
  at most the access tokens already issued (up to 15 minutes each).
- **Cleanup: the row is deleted when the family is revoked**, in the same transaction, under the lock (every
  revocation goes through one method). Revocation is final: a revoked token is refused before the lock and no
  token is ever added to a revoked family, so the row guards nothing after that. Chosen over keeping rows until
  the family expires because it needs no sweeper job and keeps the table at the families whose revocation is
  still pending. A row stays only when the locked attempt failed and no token of the family is presented again;
  such a family can never refresh, and its row is harmless. A sweep (`created_at` older than `refresh-ttl` plus
  a margin) can be added if those rows ever matter. `family_id` is not a foreign key (there is no family
  table), and no code path deletes users or tokens today.
- **Failures and logging.** Only one case leaves a family live: neither the row nor the locked revoke could be
  written (the database is down). That, and a failure of the family lookup itself, logs one ERROR line naming
  the family id, or a 12-character prefix of the token hash when the family is not known yet, plus the
  exception class, and answers 503 `request.busy` without `Retry-After`. The line never carries the raw token
  and no stack: the 503 is a handled error, so the container does not log the exception a second time (stacks
  at DEBUG). A locked attempt that fails after the row was written logs one WARN with the family id: the row
  will end the family. The cookie is cleared in every case, also on an unhandled 500 through the container's
  `/error` dispatch (`SignOutErrorDispatchIT`, `AuthServiceSignOutTest`). This corrects slice 1's wording
  ("any failure logs the family id"): the lookup ran before the logged path, so a lookup failure logged
  nothing.
- **Expiry boundary.** A token whose `expires_at` equals `now()` is expired everywhere: when presented, in the
  dead-token check before the lock, and in the grace check's "the successor is live" (`RefreshExpiryBoundaryIT`).
- **The client keeps the session through a transient failure, never through a dead one** (PR #36 review).
  A refresh answered 5xx, 408, 429 or not at all (the network) is retried once after `Retry-After` (at most
  5 s, 1 s if missing); the session is kept until 3 refreshes in a row end that way, then cleared. A
  definitive answer (401, any other 4xx, a 2xx without an access token) clears the session at once and the
  app goes to sign-in, so the browser never keeps an access token the server rejected
  (`frontend/src/api/session.ts`, `session.test.ts`, `client.ts`).
- **Lock contention classification.** `DependencyService` uses the shared `LockContention` (40P01, 40001,
  55P03). It still answers 409 `dependency.busy` where the global mapping answers 503 `request.busy`; which
  status the API should use is open, for JT Francisco.

## Upgrade note: `TASKFLOW_REFRESH_REUSE_GRACE` units

`JwtProperties.refreshReuseGrace` carries `@DurationUnit(SECONDS)` since slice 1. A bare number now means
seconds: `TASKFLOW_REFRESH_REUSE_GRACE=30` was 30 ms before and is 30 s now. Values with a unit (`PT30S`,
`30s`, `500ms`) bind as before. An environment that set a bare number meaning milliseconds must add `ms`
(`500` becomes `500ms`); a bare number above 300 now fails at startup (the `PT5M` cap). The default and the
README use `PT30S` and are unaffected.
