package com.taskflow.workspace;

import java.util.Map;
import java.util.UUID;

/**
 * The one private-location visibility rule as SQL (permission-matrix.md, AD-3), shared by the
 * evaluator, the tree endpoint, scoped task listings and the trash, so they cannot disagree. Use it
 * with a NamedParameterJdbcTemplate and {@link #params(UUID, Role)}.
 */
public final class LocationAccess {

  private LocationAccess() {}

  /**
   * A boolean SQL expression that is true when the location aliased as {@code alias} is live and
   * visible to the user and role bound as {@code :uid} and {@code :role}.
   */
  public static String visible(String alias) {
    String l = alias;
    return "("
        + l
        + ".deleted_at IS NULL AND ("
        + ":role IN ('OWNER', 'ADMIN')"
        + " OR (:role = 'MEMBER' AND NOT EXISTS (SELECT 1 FROM location a"
        + " WHERE a.workspace_id = "
        + l
        + ".workspace_id AND a.path @> "
        + l
        + ".path AND a.is_private))"
        + "))";
  }

  public static Map<String, Object> params(UUID userId, Role role) {
    return Map.of("uid", userId, "role", role.name());
  }
}
