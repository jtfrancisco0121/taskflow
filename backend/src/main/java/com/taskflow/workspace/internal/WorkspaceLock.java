package com.taskflow.workspace.internal;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Serialises structural location writes per workspace with a transaction-scoped advisory lock
 * (decision 002 item 6): crossed moves under READ COMMITTED could otherwise form cycles.
 */
@Component
class WorkspaceLock {

  private final JdbcTemplate jdbc;

  WorkspaceLock(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  void lock(UUID workspaceId) {
    long key = workspaceId.getMostSignificantBits() ^ workspaceId.getLeastSignificantBits();
    jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> {}, key);
  }
}
