# 002: Phase 1 core backend choices and deviations

Date: 2026-11-24. Status: accepted.

These choices were made while building the Phase 1 core backend (AUTH, WS, LOC, TASK, STAT, CMT requirements). Items 1 to 3 deviate from `docs/architecture.md`.

1. **The PermissionEvaluator lives in `workspace`, not `identity`** (architecture section 4). The roles, locations and grants it reads are workspace tables, and `identity` cannot depend on `workspace` without a module cycle. `identity` only enables method security and finds the evaluator by Spring type. Resource types owned by later modules (TASK, COMMENT, CHECKLIST) reach it through the `PermissionTargetResolver` SPI in `shared`. Besides VIEW, COMMENT, EDIT and MANAGE the evaluator knows CREATE (add a child under a location), UNARCHIVE, RESTORE (a trashed task) and DELETE (the workspace), because the permission matrix needs rules that "edit" cannot express.
2. **`RankService` lives in `shared`, not `task`** (architecture section 5). Locations, statuses and checklists rank rows too, so one pure base-62 fractional-index function and one `RankAllocator` serve every scope. Callers lock the scope's owner row first (`RankScopeLock`).
3. **jOOQ is deferred to phase 2.** Phase 1 reads and writes use `JdbcTemplate` (and JPA only for test probes). The view compiler that needs dynamic queries arrives with VIEW-1. As a consequence, optimistic locking on `task.version` is an explicit `UPDATE ... WHERE version = ?` instead of a JPA `@Version`.
4. **Idempotency runs in a servlet filter that owns the transaction.** `Idempotency-Key` on an `@Idempotent` create makes `IdempotencyFilter` open the transaction, insert the `idempotency_record`, run the handler, and store the response in the same transaction. The response is buffered and written only after the commit; non-2xx outcomes roll everything back, so a retry runs again. A failure at flush or commit becomes problem+json (409 or 500), never a 2xx.
5. **No outbox relay in phase 1.** `outbox_event` rows are written atomically with the change; nothing consumes them until RT-1 (phase 2).
6. **Location structure writes take a per-workspace advisory lock; task re-parent and move lock the List rows.** Crossed moves under READ COMMITTED could otherwise form cycles and stale `ltree` paths.
7. **The refresh token travels only in an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/auth`.** Access tokens carry `sub` and `email` only; roles resolve per request.
8. **Owner and admin see private locations without a grant.** Assumption of the spec, one evaluator branch.
