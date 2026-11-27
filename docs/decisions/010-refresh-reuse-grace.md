# 010: A refresh token whose rotation response was lost

Status: accepted. Decided by JT Francisco, 2026-11-28: option (b), the same successor for 30 s, the key derived
from the JWT secret. Context: ClickUp
14yq6g334jy. A page reload aborts an in-flight `POST /api/v1/auth/refresh` after the server has rotated the
refresh token. The browser never processes the `Set-Cookie`, keeps the old token, and the reloaded page's boot
refresh presents it. `AuthService.refresh` treats any spent token as theft and revokes the whole family, so the
user is signed out. Seen 1 in 120 e2e runs at workers=4 (theme-screens System test). In the trace
`artifacts/e2e-failures/auth-refresh-race-20261127-235117` the aborted refresh starts at 15:49:02.477Z and is
cancelled after 599 ms; the next boot refresh starts at 15:49:04.168Z, 1.7 s later, and gets 401.

## How it works today

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

The tests `RefreshReloadRaceIT` (red today: 401 where 200 is expected, and `[200, 401]` for two concurrent
refreshes) describe the wanted behaviour. `RefreshReuseGuardIT` (green today) pins what must not change: a
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
- Complexity: small, inside `AuthService.refresh`: lock A's row (`FOR UPDATE`), derive B on rotation instead of
  random bytes; on a rotated A, return B if A is not revoked or expired, was rotated less than N ago, and the
  family's only live token is B (unrevoked, unexpired, never rotated; hashes compared with
  `MessageDigest.isEqual`); otherwise revoke as today. No migration.
- Multi-tab: two concurrent refreshes with A both get the same B (the loser's `UPDATE` waits for the winner's
  commit, then finds B), so the cookie jar is right whichever response lands last. Passes both race tests.

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
  Rotating the JWT secret breaks only replays in flight at that moment.
- A grace replay should be logged (family id, no token), so a pattern of replays is visible.
