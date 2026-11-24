package com.taskflow.workspace;

import java.util.Map;
import java.util.UUID;

/**
 * The one private-location visibility rule as SQL (permission-matrix.md, AD-3), shared by the
 * evaluator, the tree endpoint, scoped task listings and the trash, so they cannot disagree. Use it
 * with a NamedParameterJdbcTemplate and {@link #params(UUID, Role)}.
 *
 * <ul>
 *   <li>Owner and admin see every live location.
 *   <li>A member sees a location when every private location on its path (itself included) has a
 *       grant for the member.
 *   <li>A guest sees a location when they hold a grant on it or on an ancestor, and every private
 *       location below that grant on its path also has a grant.
 * </ul>
 */
public final class LocationAccess {

  private LocationAccess() {}

  /**
   * A boolean SQL expression that is true when the location aliased as {@code alias} is live and
   * visible to the user and role bound as {@code :uid} and {@code :role}. The alias must expose
   * {@code workspace_id}, {@code path} and {@code deleted_at}.
   */
  public static String visible(String alias) {
    return build(alias, ":uid", ":role");
  }

  /**
   * The same rule for jOOQ plain-SQL templates: {@code {0}} is the user id and {@code {1}} the role
   * name, bound with {@code DSL.val}. Built by the same code as {@link #visible(String)}, so the
   * two forms cannot diverge.
   */
  public static String condition(String alias) {
    return build(alias, "{0}", "{1}");
  }

  private static String build(String l, String uid, String role) {
    return "("
        + l
        + ".deleted_at IS NULL AND ("
        + role
        + " IN ('OWNER', 'ADMIN')"
        // member: no private location on the path lacks a grant
        + " OR ("
        + role
        + " = 'MEMBER' AND NOT EXISTS (SELECT 1 FROM location a"
        + " WHERE a.workspace_id = "
        + l
        + ".workspace_id AND a.path @> "
        + l
        + ".path AND a.is_private AND NOT EXISTS (SELECT 1 FROM location_grant g"
        + " WHERE g.workspace_id = a.workspace_id AND g.location_id = a.id AND g.user_id = "
        + uid
        + ")))"
        // guest: a granted ancestor-or-self, and no ungranted private location below it
        + " OR ("
        + role
        + " = 'GUEST' AND EXISTS (SELECT 1 FROM location_grant gg JOIN location ga ON"
        + " ga.workspace_id = gg.workspace_id AND ga.id = gg.location_id WHERE gg.workspace_id = "
        + l
        + ".workspace_id AND gg.user_id = "
        + uid
        + " AND ga.path @> "
        + l
        + ".path AND NOT EXISTS (SELECT 1 FROM location a WHERE a.workspace_id = "
        + l
        + ".workspace_id AND a.path @> "
        + l
        + ".path AND nlevel(a.path) > nlevel(ga.path) AND a.is_private AND NOT EXISTS (SELECT 1 FROM"
        + " location_grant g2 WHERE g2.workspace_id = a.workspace_id AND g2.location_id = a.id AND"
        + " g2.user_id = "
        + uid
        + "))))"
        + "))";
  }

  public static Map<String, Object> params(UUID userId, Role role) {
    return Map.of("uid", userId, "role", role.name());
  }
}
