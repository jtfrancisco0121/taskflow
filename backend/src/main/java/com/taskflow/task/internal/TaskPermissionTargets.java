package com.taskflow.task.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Maps a task to its workspace and home List for the PermissionEvaluator (AD-3). */
@Component
class TaskPermissionTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  TaskPermissionTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "TASK";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    return jdbc
        .query(
            "SELECT workspace_id, list_id, deleted_at IS NOT NULL AS trashed FROM task WHERE id = ?",
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
