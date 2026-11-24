package com.taskflow.field.internal;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Serialises custom field definition writes per Workspace (AD-5) with a transaction-scoped advisory
 * lock in its own namespace (the two-int form never collides with the one-bigint workspace lock).
 * Lock order: a Location move holds the workspace lock and its target's row lock and then takes
 * this lock; a field write takes the row lock of its Location first ({@link #lockLocation}) and
 * then this lock, and never the workspace lock, so the two cannot form a cycle.
 */
@Component
class FieldLock {

  private static final int NAMESPACE = 0x464c4400; // "FLD\0"

  private final JdbcTemplate jdbc;

  FieldLock(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /**
   * Waits for a concurrent move that holds this Location row for update, while holding nothing
   * itself, so the foreign-key check of the write that follows can never wait on that move.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  void lockLocation(UUID locationId) {
    jdbc.query("SELECT 1 FROM location WHERE id = ? FOR KEY SHARE", rs -> {}, locationId);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  void lock(UUID workspaceId) {
    long k = workspaceId.getMostSignificantBits() ^ workspaceId.getLeastSignificantBits();
    int key = (int) (k ^ (k >>> 32));
    jdbc.query("SELECT pg_advisory_xact_lock(?, ?)", rs -> {}, NAMESPACE, key);
  }
}
