package com.taskflow.shared;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Locks the row that owns a rank scope before a rank is computed, so two concurrent appends cannot
 * read the same last rank (AD-10).
 */
@Component
public class RankScopeLock {

  /** The tables that own a rank scope. */
  public enum Owner {
    WORKSPACE("workspace"),
    LOCATION("location"),
    TASK("task"),
    CHECKLIST("checklist");

    private final String table;

    Owner(String table) {
      this.table = table;
    }
  }

  private final JdbcTemplate jdbc;

  RankScopeLock(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void lock(Owner owner, UUID id) {
    jdbc.query("SELECT 1 FROM " + owner.table + " WHERE id = ? FOR UPDATE", rs -> {}, id);
  }
}
