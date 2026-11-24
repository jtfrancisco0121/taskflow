package com.taskflow.identity.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service accounts of a Workspace (SA-1..SA-4). A service account is an app_user row of kind
 * SERVICE_ACCOUNT with a same-id service_account row, and never a workspace_member row.
 */
@Service
class ServiceAccountService {

  record ServiceAccountView(
      UUID id,
      String name,
      boolean disabled,
      Instant disabledAt,
      int activeKeys,
      Instant lastUsedAt,
      Instant createdAt) {}

  private static final String SELECT =
      "SELECT s.id, s.name, s.disabled_at, s.created_at,"
          + " (SELECT count(*) FROM api_key k WHERE k.service_account_id = s.id"
          + " AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()))"
          + " AS active_keys,"
          + " (SELECT max(k.last_used_at) FROM api_key k WHERE k.service_account_id = s.id)"
          + " AS last_used_at FROM service_account s";

  private static final RowMapper<ServiceAccountView> VIEW =
      (rs, i) ->
          new ServiceAccountView(
              rs.getObject("id", UUID.class),
              rs.getString("name"),
              rs.getTimestamp("disabled_at") != null,
              rs.getTimestamp("disabled_at") == null
                  ? null
                  : rs.getTimestamp("disabled_at").toInstant(),
              rs.getInt("active_keys"),
              rs.getTimestamp("last_used_at") == null
                  ? null
                  : rs.getTimestamp("last_used_at").toInstant(),
              rs.getTimestamp("created_at").toInstant());

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final ApiKeyNegativeCache negativeCache;

  ServiceAccountService(
      JdbcTemplate jdbc, EventRecorder events, ApiKeyNegativeCache negativeCache) {
    this.jdbc = jdbc;
    this.events = events;
    this.negativeCache = negativeCache;
  }

  /** Management is for people: a key never manages service accounts or keys (AD-9). */
  static void requireHuman() {
    Actor actor = CurrentActor.require();
    if (actor.type() != ActorType.USER) {
      throw TaskflowException.forbidden(
          "auth.forbidden", "Service accounts and keys are managed by people, not by keys");
    }
  }

  @Transactional(readOnly = true)
  Page<ServiceAccountView> list(UUID workspaceId, String cursor, Integer requestedLimit) {
    requireHuman();
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    List<ServiceAccountView> rows =
        jdbc.query(
            SELECT
                + " WHERE s.workspace_id = ?"
                + (after == null ? "" : " AND s.id > ?")
                + " ORDER BY s.id LIMIT ?",
            VIEW,
            after == null
                ? new Object[] {workspaceId, limit + 1}
                : new Object[] {workspaceId, PageCursor.uuid(after.get(0)), limit + 1});
    return PageCursor.page(rows, limit, v -> PageCursor.encode(v.id().toString()));
  }

  @Transactional(readOnly = true)
  ServiceAccountView get(UUID workspaceId, UUID id) {
    requireHuman();
    return view(workspaceId, id);
  }

  @Transactional
  ServiceAccountView create(UUID workspaceId, String name) {
    requireHuman();
    String clean = name.trim();
    UUID id = Ids.newId();
    try {
      jdbc.update(
          "INSERT INTO app_user (id, kind, display_name) VALUES (?, 'SERVICE_ACCOUNT', ?)",
          id,
          clean);
      jdbc.update(
          "INSERT INTO service_account (id, workspace_id, name, created_by) VALUES (?, ?, ?, ?)",
          id,
          workspaceId,
          clean,
          CurrentActor.userId());
    } catch (DuplicateKeyException e) {
      throw taken();
    }
    events.record(
        workspaceId, "service_account", id, "service_account.created", Map.of("name", clean));
    return view(workspaceId, id);
  }

  @Transactional
  ServiceAccountView rename(UUID workspaceId, UUID id, String name) {
    requireHuman();
    String before = require(workspaceId, id).name();
    String clean = name.trim();
    try {
      jdbc.update("UPDATE service_account SET name = ? WHERE id = ?", clean, id);
    } catch (DuplicateKeyException e) {
      throw taken();
    }
    jdbc.update("UPDATE app_user SET display_name = ? WHERE id = ?", clean, id);
    events.record(
        workspaceId,
        "service_account",
        id,
        "service_account.renamed",
        Map.of("name", Map.of("from", before, "to", clean)));
    return view(workspaceId, id);
  }

  @Transactional
  ServiceAccountView disable(UUID workspaceId, UUID id) {
    requireHuman();
    require(workspaceId, id);
    int changed =
        jdbc.update(
            "UPDATE service_account SET disabled_at = now() WHERE id = ? AND disabled_at IS NULL",
            id);
    if (changed > 0) {
      events.record(workspaceId, "service_account", id, "service_account.disabled", Map.of());
    }
    return view(workspaceId, id);
  }

  @Transactional
  ServiceAccountView enable(UUID workspaceId, UUID id) {
    requireHuman();
    require(workspaceId, id);
    int changed =
        jdbc.update(
            "UPDATE service_account SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT"
                + " NULL",
            id);
    if (changed > 0) {
      events.record(workspaceId, "service_account", id, "service_account.enabled", Map.of());
      // Keys that failed while the account was disabled must work at once, not after the cache
      // entry expires. Cleared after commit so a racing lookup cannot re-write a stale entry.
      List<String> hashes =
          jdbc.queryForList(
              "SELECT key_hash FROM api_key WHERE service_account_id = ?", String.class, id);
      negativeCache.forgetAfterCommit(hashes);
    }
    return view(workspaceId, id);
  }

  /** The account, or 404 when it does not exist or belongs to another Workspace. */
  ServiceAccountView require(UUID workspaceId, UUID id) {
    return view(workspaceId, id);
  }

  private ServiceAccountView view(UUID workspaceId, UUID id) {
    return jdbc
        .query(SELECT + " WHERE s.id = ? AND s.workspace_id = ?", VIEW, id, workspaceId)
        .stream()
        .findFirst()
        .orElseThrow(() ->
            TaskflowException.notFound("service_account.not_found", "Service account not found"));
  }

  private static TaskflowException taken() {
    return TaskflowException.conflict(
        "service_account.name_taken", "A service account with that name already exists");
  }
}
