package com.taskflow.task.internal;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Serialises relationship writes per Workspace (AD-2) with a transaction-scoped advisory lock in a
 * namespace of its own (the two-int form never collides with the one-bigint workspace lock or the
 * field lock), so two adds that would together close a cycle cannot both pass the cycle check.
 */
@Component
class DependencyLock {

  private static final int NAMESPACE = 0x44455000; // "DEP\0"

  private final JdbcTemplate jdbc;

  DependencyLock(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  void lock(UUID workspaceId) {
    long k = workspaceId.getMostSignificantBits() ^ workspaceId.getLeastSignificantBits();
    int key = (int) (k ^ (k >>> 32));
    jdbc.query("SELECT pg_advisory_xact_lock(?, ?)", rs -> {}, NAMESPACE, key);
  }
}
