package com.taskflow.identity.internal;

import com.taskflow.identity.AutomationAuthors;
import com.taskflow.shared.Ids;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class AutomationAuthorsImpl implements AutomationAuthors {

  private final JdbcTemplate jdbc;
  private final TransactionTemplate own;

  AutomationAuthorsImpl(JdbcTemplate jdbc, PlatformTransactionManager transactions) {
    this.jdbc = jdbc;
    this.own = new TransactionTemplate(transactions);
    this.own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  @Override
  public UUID authorFor(UUID workspaceId) {
    UUID existing = find(workspaceId);
    if (existing != null) {
      return existing;
    }
    // Created in its own short transaction under an advisory lock per Workspace, so two threads
    // that race create one user and the loser reads the winner's row.
    return own.execute(status -> {
      jdbc.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
          rs -> {},
          "automation_author:" + workspaceId);
      UUID raced = find(workspaceId);
      if (raced != null) {
        return raced;
      }
      UUID id = Ids.newId();
      jdbc.update(
          "INSERT INTO app_user (id, kind, display_name) VALUES (?, 'AUTOMATION', 'Automation')",
          id);
      jdbc.update(
          "INSERT INTO automation_author (workspace_id, user_id) VALUES (?, ?)", workspaceId, id);
      return id;
    });
  }

  @Override
  public Set<UUID> authorsAmong(Collection<UUID> userIds) {
    if (userIds.isEmpty()) {
      return Set.of();
    }
    return new HashSet<>(
        jdbc.queryForList(
            "SELECT id FROM app_user WHERE kind = 'AUTOMATION' AND id = ANY (?::uuid[])",
            UUID.class,
            (Object) userIds.toArray(new UUID[0])));
  }

  private UUID find(UUID workspaceId) {
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT user_id FROM automation_author WHERE workspace_id = ?",
            UUID.class,
            workspaceId);
    return ids.isEmpty() ? null : ids.get(0);
  }
}
