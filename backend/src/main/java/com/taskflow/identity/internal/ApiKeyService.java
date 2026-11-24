package com.taskflow.identity.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Hashing;
import com.taskflow.shared.Ids;
import com.taskflow.shared.TaskflowException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * API keys of a service account (KEY-1..KEY-5). The secret is shown once, in the create response;
 * only its SHA-256 hash, the fixed prefix and the last four characters are stored.
 */
@Service
class ApiKeyService {

  static final String PREFIX = "tf_sk_";

  record ApiKeyView(
      UUID id,
      String name,
      String prefix,
      String last4,
      String status,
      Instant expiresAt,
      Instant lastUsedAt,
      Instant revokedAt,
      Instant createdAt) {}

  /** The one response that carries the secret. */
  record CreatedApiKey(ApiKeyView key, String secret) {}

  private static final RowMapper<ApiKeyView> VIEW =
      (rs, i) -> {
        Instant expires = instant(rs.getTimestamp("expires_at"));
        Instant revoked = instant(rs.getTimestamp("revoked_at"));
        String status =
            revoked != null
                ? "REVOKED"
                : expires != null && !expires.isAfter(Instant.now()) ? "EXPIRED" : "ACTIVE";
        return new ApiKeyView(
            rs.getObject("id", UUID.class),
            rs.getString("name"),
            rs.getString("prefix"),
            rs.getString("last4"),
            status,
            expires,
            instant(rs.getTimestamp("last_used_at")),
            revoked,
            rs.getTimestamp("created_at").toInstant());
      };

  private static final String SELECT =
      "SELECT id, name, prefix, last4, expires_at, last_used_at, revoked_at, created_at FROM"
          + " api_key";

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final ServiceAccountService accounts;

  ApiKeyService(JdbcTemplate jdbc, EventRecorder events, ServiceAccountService accounts) {
    this.jdbc = jdbc;
    this.events = events;
    this.accounts = accounts;
  }

  @Transactional(readOnly = true)
  List<ApiKeyView> list(UUID workspaceId, UUID accountId) {
    ServiceAccountService.requireHuman();
    accounts.require(workspaceId, accountId);
    return jdbc.query(
        SELECT + " WHERE service_account_id = ? ORDER BY created_at DESC, id DESC",
        VIEW,
        accountId);
  }

  @Transactional
  CreatedApiKey create(UUID workspaceId, UUID accountId, String name, Instant expiresAt) {
    ServiceAccountService.requireHuman();
    accounts.require(workspaceId, accountId);
    if (expiresAt != null && !expiresAt.isAfter(Instant.now())) {
      throw new TaskflowException(
          HttpStatus.UNPROCESSABLE_ENTITY, "api_key.expiry_in_past", "The expiry is in the past");
    }
    String secret = PREFIX + Hashing.newToken();
    UUID id = Ids.newId();
    String clean = name.trim();
    jdbc.update(
        "INSERT INTO api_key (id, workspace_id, service_account_id, name, key_hash, prefix, last4,"
            + " expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        workspaceId,
        accountId,
        clean,
        Hashing.sha256Hex(secret),
        PREFIX,
        secret.substring(secret.length() - 4),
        expiresAt == null ? null : java.sql.Timestamp.from(expiresAt),
        CurrentActor.userId());
    // The event names the key and the account, never the secret.
    events.record(
        workspaceId,
        "api_key",
        id,
        "api_key.created",
        Map.of("serviceAccountId", accountId.toString(), "name", clean));
    return new CreatedApiKey(jdbc.queryForObject(SELECT + " WHERE id = ?", VIEW, id), secret);
  }

  /** Revoking is final and idempotent: a revoked key never works again. */
  @Transactional
  void revoke(UUID workspaceId, UUID accountId, UUID keyId) {
    ServiceAccountService.requireHuman();
    accounts.require(workspaceId, accountId);
    if (jdbc.queryForObject(
            "SELECT count(*) FROM api_key WHERE id = ? AND service_account_id = ?",
            Integer.class,
            keyId,
            accountId)
        == 0) {
      throw TaskflowException.notFound("api_key.not_found", "API key not found");
    }
    int changed =
        jdbc.update(
            "UPDATE api_key SET revoked_at = now() WHERE id = ? AND revoked_at IS NULL", keyId);
    if (changed > 0) {
      events.record(
          workspaceId,
          "api_key",
          keyId,
          "api_key.revoked",
          Map.of("serviceAccountId", accountId.toString()));
    }
  }

  private static Instant instant(java.sql.Timestamp ts) {
    return ts == null ? null : ts.toInstant();
  }
}
