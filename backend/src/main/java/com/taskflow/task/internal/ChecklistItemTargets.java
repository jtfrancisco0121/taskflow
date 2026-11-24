package com.taskflow.task.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** A checklist item is judged by its task's List (AD-3). */
@Component
class ChecklistItemTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  ChecklistItemTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "CHECKLIST_ITEM";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    return jdbc
        .query(
            "SELECT t.workspace_id, t.list_id, t.deleted_at IS NOT NULL AS trashed FROM task t JOIN"
                + " checklist c ON c.task_id = t.id JOIN checklist_item i ON i.checklist_id = c.id WHERE"
                + " i.id = ?",
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
