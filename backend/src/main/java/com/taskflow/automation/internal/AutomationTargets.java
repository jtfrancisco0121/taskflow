package com.taskflow.automation.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Maps a rule to the Location that defines it, for the PermissionEvaluator (AD-3, AD-8). */
@Component
class AutomationTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  AutomationTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "AUTOMATION";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    return jdbc
        .query(
            "SELECT workspace_id, location_id, deleted_at IS NOT NULL AS gone FROM automation_rule"
                + " WHERE id = ?",
            (rs, i) ->
                new PermissionTarget(
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("location_id", UUID.class),
                    rs.getBoolean("gone")),
            id)
        .stream()
        .findFirst();
  }
}
