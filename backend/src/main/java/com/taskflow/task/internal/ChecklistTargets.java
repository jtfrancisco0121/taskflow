package com.taskflow.task.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** A checklist is judged by its task's List (AD-3). */
@Component
class ChecklistTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  ChecklistTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "CHECKLIST";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    return jdbc
        .query(
            "SELECT t.workspace_id, t.list_id, t.deleted_at IS NOT NULL AS trashed FROM task t JOIN"
                + " checklist c ON c.task_id = t.id WHERE c.id = ?",
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
