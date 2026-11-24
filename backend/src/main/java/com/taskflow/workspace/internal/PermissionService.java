package com.taskflow.workspace.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The one place that decides who may do what (AD-3, permission-matrix.md). Not visible answers 404,
 * never 403: a caller must not learn that a hidden resource exists.
 */
@Service
class PermissionService implements Permissions {

  private final MembershipLookup memberships;

  PermissionService(MembershipLookup memberships) {
    this.memberships = memberships;
  }

  @Override
  public void require(String type, UUID id, Action action) {
    switch (type) {
      case WORKSPACE -> requireWorkspace(id, action);
      default ->
          throw TaskflowException.forbidden("auth.forbidden", "Unknown resource type " + type);
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
      throw TaskflowException.forbidden("auth.forbidden", "Your role may not do this");
    }
  }
}
