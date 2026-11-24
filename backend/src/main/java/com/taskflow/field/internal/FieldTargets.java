package com.taskflow.field.internal;

import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Maps a custom field to the Location that defines it, for the PermissionEvaluator (AD-3, AD-9).
 */
@Component
class FieldTargets implements PermissionTargetResolver {

  private final JdbcTemplate jdbc;

  FieldTargets(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String type() {
    return "FIELD";
  }

  @Override
  public Optional<PermissionTarget> resolve(UUID id) {
    // A retired field is still addressable (a stale client gets 409 or the current field), so it is
    // not "trashed".
    return jdbc
        .query(
            "SELECT workspace_id, location_id FROM custom_field WHERE id = ?",
            (rs, i) ->
                new PermissionTarget(
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("location_id", UUID.class),
                    false),
            id)
        .stream()
        .findFirst();
  }
}
