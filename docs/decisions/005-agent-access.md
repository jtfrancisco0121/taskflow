# 005: Phase 3 agent access

Status: accepted. Context: SA-1..4, KEY-1..7 and MCP-1..4 (service accounts, API keys, per-key rate
limits, the audit view and the MCP endpoint). It follows `docs/architecture.md` section 9 and records
where it differs or adds detail.

## Decisions

1. **A service account is an `app_user` row (AD-2).** `app_user.kind` is `HUMAN` or `SERVICE_ACCOUNT`;
   a service account has no email and no password (a check keeps every `HUMAN` row complete), plus a
   same-id `service_account` row with its Workspace, name and `disabled_at`. `task.created_by`,
   `comment.author_id`, `view.owner_id` and the other foreign keys therefore need no change, and names
   resolve through the same user lookup. Sign-in, refresh and email lookups only see `HUMAN` rows.
2. **A service account is never a `workspace_member` (SA-2).** `WorkspaceQuery.roleOf` returns `ADMIN`
   for a service account in its own Workspace and nothing anywhere else, so every permission check works
   unchanged. A key gets 403 `auth.forbidden` on creating a Workspace, leaving one and accepting an
   invite, and `GET /workspaces` returns its one Workspace with role `ADMIN`.
3. **Management is for people only (AD-9).** Every `/workspaces/{id}/service-accounts/**` endpoint needs
   `WORKSPACE MANAGE` and refuses a non-user actor with 403, so a leaked key cannot mint, revive or
   inspect keys. AD-9 does not stop persistence through invites: a key is `ADMIN` (SA-2), so it can
   invite a human admin who can then mint keys. Revoke, disable and the audit view (invites show in it)
   are the answer, and a human can revoke the invite.
4. **Endpoint paths differ from architecture section 9.** Service accounts live under
   `/api/v1/workspaces/{workspaceId}/service-accounts`, with `.../{id}/api-keys`,
   `.../{id}/disable|enable`, `.../{id}/audit` and `.../{id}/activity`.
5. **A fixed one-minute window replaces the token bucket (AD-7).** Section 9 says "Redis token bucket".
   The limiter is the existing `shared.RateLimiter` fixed window, one counter per key and epoch minute,
   shared by REST and MCP, default 100 calls per minute (`taskflow.api-keys.rate-limit.plans.default`;
   PRD open question 6). `X-RateLimit-Reset` is the start of the next minute and `Retry-After` is
   computed from the same minute, so the two always agree. A fixed window allows up to twice the limit
   across a minute boundary; that is accepted. `RateLimiter.hit` is one Lua script (`INCR`, then `PEXPIRE`
   when the key has no TTL), so a counter can never be left without an expiry; this also fixes the
   sign-in limiter. If Redis fails, a key request fails closed with 503 `rate_limit.unavailable`.
6. **Invalid keys never block valid ones (no per-IP gate).** Behind the reverse proxy and the Vite dev
   proxy every caller has the proxy's address and the app does not trust `X-Forwarded-For`, so a per-IP
   gate in front of the key lookup would lock out every key at once. Instead a value that is not
   `tf_sk_` plus 43 base64url characters gets 401 without a query, and a failed lookup writes
   `apikey-neg:<hash>` for 60 s so a retry loop with a revoked key does not reach Postgres. Failures are
   still counted per IP for a WARN log and a metric (`taskflow.api_key.failures`), never to block. The
   cache only adds denials and every reason a lookup fails is final except a disabled account, so
   `enable` clears the account's entries after commit. A Postgres error is never cached. Anything that
   makes a failed key valid again (for example extending an expiry) must clear the cache too.
7. **Only the hash is stored and the secret is shown once (KEY-1).** The secret appears only in the 201
   response of `POST .../api-keys` (`Cache-Control: no-store`, no `Idempotency-Key`), never in events,
   logs or a 401 body. The filter checks Postgres on every request (AD-6), so revoke and disable take
   effect at once.
8. **MCP is for service-account keys only (AD-11).** `/api/v1/mcp` is a stateless streamable-HTTP server
   (MCP Java SDK `mcp-core` and `mcp-json-jackson2`, pinned to 1.1.5: 2.x needs Jackson 2.22 and Reactor
   3.9, which Spring Boot 3.5 does not provide). It sits behind the normal security chain: no key is 401,
   a JWT is 403.
9. **Tools run on the request thread (AD-10).** The server is built with `immediateExecution(true)`, so
   the key filter's security context is the caller of every tool and writes carry the service account and
   the key. No `SecurityContext` copy helper was needed; `TaskAgentToolsIT` and `AgentGateIT` assert the
   actor and key on every write. Tools are `shared.AgentTool` beans owned by their module (`task`,
   `workspace`, `view`); each does the same `Permissions.require` and service call as its REST
   endpoint and returns the same view. A `TaskflowException` becomes a tool result with `isError: true`
   and the REST problem `code`, including `current` on a 409. Lock contention (40P01, 40001, 55P03)
   raised anywhere in a tool call is `request.busy` (status 503), never `internal`; a tool result has no
   headers, so the REST `Retry-After` comes as `retryAfterSeconds` (whole seconds) in the error body,
   for every tool (ClickUp 14yq6g33592).
10. **Plain-text tool inputs (AD-12).** `description` and `text` are plain text, one rich-text paragraph
    per line, validated by `RichText.validate`.
11. **MCP creates take an optional `idempotencyKey` argument** (updated after the Phase 3 review;
    first shipped as deferred; `update_task` joined in 3A, item 15). `create_task` and `add_comment` accept it; the MCP endpoint adds it to
    their schema and description and runs the call through `shared.IdempotentCalls`, which uses the
    same `idempotency_record` table and rules as the REST `Idempotency-Key` filter: the record and the
    effect commit together, only a success is stored, the same key and arguments return the first
    result, the same key with other arguments fails with `idempotency.key_reused`, a concurrent second
    call waits on the unique key and then replays, and records expire after 24 hours. Keys are scoped
    per service account (`actor_id`). The request hash is SHA-256 of the tool name and the other
    arguments with keys sorted, so argument order does not matter. A call without the key behaves as
    before. Tests: `McpIdempotencyIT`.
12. **Key administration is not broadcast.** `service_account` and `api_key` events are recorded in the
    audit trail but `EventRouter` routes them to no STOMP topic.
13. **Attribution.** `activity_event.actor_key_id` and `outbox_event.actor_key_id` carry the key; the
    activity APIs return `actorKeyId` and `actorKeyName`, and the task Activity tab reads
    "triage-agent (key CI-1)" with an Agent badge.
14. **Client IP behind a reverse proxy** (added after the Phase 3 review; item 6 covered keys, this
    covers human sign-in). `server.forward-headers-strategy: native` installs Tomcat's
    `RemoteIpValve`, and `shared/internal/TrustedProxyConfig` limits its trusted proxies to the exact
    IP addresses in `taskflow.http.trusted-proxies` (`TASKFLOW_TRUSTED_PROXIES`), by default none;
    Tomcat's default trust of private ranges is switched off. Only a connection from a listed proxy
    may set the client IP through `X-Forwarded-For`, read right to left up to the first untrusted
    address, so a value a client prepends is ignored. `request.getRemoteAddr()` then gives the real
    client to the sign-in limit and the failed-key log. Addresses only, no CIDR ranges. Tests:
    `SignInRateLimitBehindProxyIT`, `SignInRateLimitUntrustedForwardIT`.

## Consequences

- A leaked key has admin-level power in one Workspace until it is revoked. The mitigations are instant
  revoke and disable, the per-minute limit, the 30-day trash with Restore from the audit view, and the
  audit view.
- Migrations only add (new tables, nullable columns, relaxed `NOT NULL` with a check), so the previous
  build still runs on the new schema.
15. **Custom fields over MCP (3A, decision 007).** `list_custom_fields(locationId)` returns the body of
    `GET /locations/{id}/fields` (each field with `id`, `name`, `type`, `config`, `options`, `definedAt` and
    `inherited`). `create_task` and `update_task` accept `customFields: {fieldId or field name: value}`
    through the same `TaskService` methods as REST: a Dropdown or Labels value may be an Option name, `null`
    clears a field, and an unknown Option or field answers 400 `field.invalid_value` or
    `field.not_available` naming the field and the valid Option names. `get_task` returns `customFields`.
    `update_task` is wrapped with `AgentTool.withIdempotencyKey` like `create_task`, so it takes the same
    optional `idempotencyKey`: a retry of the same update replays the first result (even if another edit
    came in between, as for REST `Idempotency-Key`), and the same key with other arguments fails with
    `idempotency.key_reused`. No new idempotency store. `search_tasks` accepts optional `locationId` and
    `customFields: [{fieldId, op, value}]`; `query` is optional when conditions are present (schema `anyOf`;
    a call with neither is refused by the service as well). A call with only `query` goes to
    `TaskSearchService` unchanged (REST `/search` is untouched). Any call with `locationId` or conditions
    goes to `TaskAgentSearch`: one jOOQ query over `task t JOIN location l` with the same base filters as the
    text search (Workspace, no trashed task, no archived List, `LocationAccess`), the scope-guarded
    `CustomFieldSql` conditions and bind values only. With `query` it ranks and pages by `(ts_rank, id)`;
    without it, by `updated_at DESC, id` with a cursor tagged `u`, so a ranked cursor is refused with
    `page.invalid_cursor`. A retired Option or a hidden or left-behind value never matches. Tests:
    `CustomFieldsMcpIT`.
    A People field takes user ids in `customFields` (a non-member is 400 `field.invalid_value` naming the
    field) and `search_tasks` conditions on it take user ids; `list_custom_fields` shows the type.
16. **Relationships over MCP (3B, decision 008).** `add_dependency(taskId, version, otherTaskId | otherRef,
    relation, idempotencyKey?)` and `remove_dependency(taskId, version, dependencyId)` call the same
    `DependencyService` methods as `POST` and `DELETE /tasks/{id}/dependencies`, after the same
    `Permissions.require` checks (Task edit on `taskId`, view on the other task). `relation` is seen from
    `taskId`: `WAITING_ON` (alias `BLOCKED_BY`), `BLOCKING` or `LINKED`. `add_dependency` is wrapped with
    `AgentTool.withIdempotencyKey` like `create_task`; errors are tool errors with the REST code
    (`dependency.cycle` with the `path`, `dependency.exists`, `dependency.limit`, `dependency.self`,
    `dependency.not_found`, `request.busy` on lock contention, `task.version_conflict`). `get_task` returns the REST task
    plus `dependencies` (the body of `GET /tasks/{id}/dependencies`; relationships to tasks the caller cannot
    see are only counted in `hiddenCount`); `blocked` and `blockerCount` are on every task and every
    `search_tasks` hit. `search_tasks` accepts `blocked: true | false`, alone or with `query`,
    `locationId` and `customFields` (schema `anyOf` gains `{"required": ["blocked"]}`) and goes through
    `TaskAgentSearch` with `BlockedSql`. Tests: `McpDependenciesIT`.
