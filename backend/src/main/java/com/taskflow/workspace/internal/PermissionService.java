package com.taskflow.workspace.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.PermissionTarget;
import com.taskflow.shared.PermissionTargetResolver;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationType;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The one place that decides who may do what (AD-3, permission-matrix.md). Not visible answers 404,
 * never 403: a caller must not learn that a hidden resource exists.
 */
@Service
class PermissionService implements Permissions {

  private record Loc(
      UUID id, UUID workspaceId, LocationType type, boolean deleted, boolean archived) {}

  private final MembershipLookup memberships;
  private final NamedParameterJdbcTemplate jdbc;
  private final Map<String, PermissionTargetResolver> resolvers = new HashMap<>();

  @Autowired
  PermissionService(
      MembershipLookup memberships,
      NamedParameterJdbcTemplate jdbc,
      List<PermissionTargetResolver> resolverBeans) {
    this.memberships = memberships;
    this.jdbc = jdbc;
    resolverBeans.forEach(r -> resolvers.put(r.type(), r));
  }

  /** Test seam: a service without a database, for the workspace rows. */
  PermissionService(MembershipLookup memberships) {
    this(memberships, null, List.of());
  }

  @Override
  public void require(String type, UUID id, Action action) {
    switch (type) {
      case WORKSPACE -> requireWorkspace(id, action);
      case LOCATION -> requireLocation(id, action);
      default -> requireResource(type, id, action);
    }
  }

  /** The caller's role in the workspace, or 404 when they are not a member. */
  Role roleInWorkspace(UUID workspaceId) {
    return memberships
        .role(workspaceId, CurrentActor.userId())
        .orElseThrow(
            () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
  }

  private void requireWorkspace(UUID workspaceId, Action action) {
    Role role = roleInWorkspace(workspaceId);
    boolean allowed =
        switch (action) {
          case VIEW, COMMENT -> true;
          case EDIT, MANAGE -> role.isAdminOrOwner();
          case DELETE -> role == Role.OWNER;
          default -> false;
        };
    if (!allowed) {
      throw forbidden();
    }
  }

  private void requireLocation(UUID locationId, Action action) {
    Loc loc = load(locationId);
    Role role = visibleRole(loc);
    boolean allowed =
        switch (action) {
          case VIEW, COMMENT -> true;
          case EDIT, DELETE, UNARCHIVE ->
              loc.type() == LocationType.SPACE ? role.isAdminOrOwner() : role.canWork();
          case CREATE -> role.canWork();
          case MANAGE -> role.isAdminOrOwner();
          default -> false;
        };
    if (!allowed) {
      throw forbidden();
    }
    if (loc.archived()
        && (action == Action.EDIT || action == Action.CREATE || action == Action.MANAGE)) {
      throw archived();
    }
  }

  /** TASK, COMMENT and CHECKLIST: resolved to the home List, then judged like a location. */
  private void requireResource(String type, UUID id, Action action) {
    PermissionTargetResolver resolver = resolvers.get(type);
    if (resolver == null) {
      throw forbidden();
    }
    PermissionTarget target =
        resolver
            .resolve(id)
            .orElseThrow(() ->
                TaskflowException.notFound(
                    type.toLowerCase(java.util.Locale.ROOT) + ".not_found", type + " not found"));
    Loc loc = load(target.locationId());
    Role role = visibleRole(loc);
    if (target.trashed() && action != Action.RESTORE) {
      throw TaskflowException.notFound(
          type.toLowerCase(java.util.Locale.ROOT) + ".not_found", type + " not found");
    }
    if (!target.trashed() && action == Action.RESTORE) {
      throw TaskflowException.conflict("task.not_trashed", "The task is not in the trash");
    }
    boolean allowed =
        switch (action) {
          case VIEW, COMMENT -> true;
          case EDIT, CREATE, DELETE, RESTORE -> role.canWork();
          case MANAGE -> role.isAdminOrOwner();
          default -> false;
        };
    if (!allowed) {
      throw forbidden();
    }
    if (loc.archived() && action != Action.VIEW && action != Action.RESTORE) {
      throw archived();
    }
  }

  private Loc load(UUID locationId) {
    return jdbc
        .query(
            "SELECT l.id, l.workspace_id, l.type, l.deleted_at IS NOT NULL AS deleted,"
                + " EXISTS (SELECT 1 FROM location a WHERE a.workspace_id = l.workspace_id AND a.path"
                + " @> l.path AND a.archived_at IS NOT NULL) AS archived FROM location l WHERE l.id ="
                + " :id",
            new MapSqlParameterSource("id", locationId),
            (rs, i) ->
                new Loc(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    LocationType.valueOf(rs.getString("type")),
                    rs.getBoolean("deleted"),
                    rs.getBoolean("archived")))
        .stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("location.not_found", "Location not found"));
  }

  /** The caller's role when the location is visible to them; 404 otherwise. */
  private Role visibleRole(Loc loc) {
    UUID userId = CurrentActor.userId();
    Role role =
        memberships
            .role(loc.workspaceId(), userId)
            .orElseThrow(
                () -> TaskflowException.notFound("location.not_found", "Location not found"));
    if (loc.deleted()) {
      throw TaskflowException.notFound("location.not_found", "Location not found");
    }
    MapSqlParameterSource params = new MapSqlParameterSource(LocationAccess.params(userId, role));
    params.addValue("id", loc.id());
    Boolean visible =
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM location l WHERE l.id = :id AND "
                + LocationAccess.visible("l")
                + ")",
            params,
            Boolean.class);
    if (!Boolean.TRUE.equals(visible)) {
      throw TaskflowException.notFound("location.not_found", "Location not found");
    }
    return role;
  }

  private static TaskflowException forbidden() {
    return TaskflowException.forbidden("auth.forbidden", "Your role may not do this");
  }

  private static TaskflowException archived() {
    return TaskflowException.conflict(
        "location.archived", "The location is archived and read-only");
  }
}
