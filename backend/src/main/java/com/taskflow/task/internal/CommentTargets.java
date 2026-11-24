package com.taskflow.task.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** A live comment is judged by its task's List (AD-3); a deleted one does not exist. */
@Component
class CommentTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  CommentTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "COMMENT";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    return jdbc
        .query(
            "SELECT t.workspace_id, t.list_id, t.deleted_at IS NOT NULL AS trashed FROM comment c JOIN"
                + " task t ON t.id = c.task_id WHERE c.id = ? AND c.deleted_at IS NULL",
            (rs, i) ->
                new PermissionTarget(
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("list_id", UUID.class),
                    rs.getBoolean("trashed")),
            id)
        .stream()
        .findFirst();
  }
}
