package com.taskflow.identity.internal;

import com.taskflow.shared.Hashing;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Resolves an API key to its service account (KEY-3, AD-6). Every request checks Postgres: the key
 * must exist, not be revoked or expired, its service account must be enabled and its Workspace
 * live. Only failed lookups are cached (see {@link ApiKeyNegativeCache}), never successes.
 */
@Component
class ApiKeyAuthenticator {

  static final String PREFIX = "tf_sk_";

  /** A key as {@code ApiKeyService} issues it: the prefix plus 32 random bytes, base64url. */
  private static final Pattern WELL_FORMED = Pattern.compile("^tf_sk_[A-Za-z0-9_-]{43}$");

  /** The outcome of a lookup. {@code keyId} etc. are set only when {@code valid}. */
  record Resolved(UUID keyId, UUID serviceAccountId, UUID workspaceId) {}

  private final JdbcTemplate jdbc;
  private final ApiKeyNegativeCache negativeCache;

  ApiKeyAuthenticator(JdbcTemplate jdbc, ApiKeyNegativeCache negativeCache) {
    this.jdbc = jdbc;
    this.negativeCache = negativeCache;
  }

  static boolean isWellFormed(String key) {
    return WELL_FORMED.matcher(key).matches();
  }

  /** Empty for any key that is not usable right now. A database error is thrown, not cached. */
  Optional<Resolved> resolve(String key) {
    if (!isWellFormed(key)) {
      return Optional.empty();
    }
    String hash = Hashing.sha256Hex(key);
    if (negativeCache.contains(hash)) {
      return Optional.empty();
    }
    Optional<Resolved> found =
        jdbc
            .query(
                "SELECT k.id, k.service_account_id, k.workspace_id FROM api_key k"
                    + " JOIN service_account s ON s.id = k.service_account_id"
                    + " JOIN workspace w ON w.id = k.workspace_id"
                    + " WHERE k.key_hash = ? AND k.revoked_at IS NULL"
                    + " AND (k.expires_at IS NULL OR k.expires_at > now())"
                    + " AND s.disabled_at IS NULL AND w.deleted_at IS NULL",
                (rs, i) ->
                    new Resolved(
                        rs.getObject("id", UUID.class),
                        rs.getObject("service_account_id", UUID.class),
                        rs.getObject("workspace_id", UUID.class)),
                hash)
            .stream()
            .findFirst();
    if (found.isEmpty()) {
      negativeCache.remember(hash);
    }
    return found;
  }
}
