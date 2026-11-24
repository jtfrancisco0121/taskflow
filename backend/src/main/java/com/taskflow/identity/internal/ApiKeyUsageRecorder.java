package com.taskflow.identity.internal;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Counts admitted calls per key and UTC day and stamps {@code last_used_at} (KEY-6). It runs in its
 * own transaction, so the request's outcome never changes the count, and never fails a request.
 */
@Component
class ApiKeyUsageRecorder {

  private static final Logger log = LoggerFactory.getLogger(ApiKeyUsageRecorder.class);

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;

  ApiKeyUsageRecorder(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.tx = new TransactionTemplate(transactionManager);
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  void record(UUID workspaceId, UUID keyId) {
    try {
      tx.executeWithoutResult(status -> {
        jdbc.update(
            "INSERT INTO api_key_usage_daily (workspace_id, api_key_id, day, calls) VALUES (?, ?,"
                + " (now() AT TIME ZONE 'UTC')::date, 1) ON CONFLICT (api_key_id, day) DO UPDATE"
                + " SET calls = api_key_usage_daily.calls + 1",
            workspaceId,
            keyId);
        // Not on every call: a write per request on a hot row is not worth a second of precision.
        jdbc.update(
            "UPDATE api_key SET last_used_at = now() WHERE id = ? AND (last_used_at IS NULL OR"
                + " last_used_at < now() - interval '1 minute')",
            keyId);
      });
    } catch (RuntimeException e) {
      log.warn("api key usage not recorded: {}", e.toString());
    }
  }
}
