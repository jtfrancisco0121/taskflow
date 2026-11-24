package com.taskflow.workspace.internal;

import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import java.io.Serializable;
import java.util.UUID;
import org.springframework.security.access.PermissionEvaluator;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

/**
 * Spring Security entry for {@code @PreAuthorize("hasPermission(#id, 'TYPE', 'ACTION')")}. It
 * returns true or throws: the not-found and forbidden answers are exceptions so that an invisible
 * resource is a 404 instead of a hint (AD-3).
 */
@Component
class PermissionEvaluatorImpl implements PermissionEvaluator {

  private final Permissions permissions;

  PermissionEvaluatorImpl(Permissions permissions) {
    this.permissions = permissions;
  }

  @Override
  public boolean hasPermission(Authentication authentication, Object target, Object permission) {
    return false;
  }

  @Override
  public boolean hasPermission(
      Authentication authentication, Serializable targetId, String targetType, Object permission) {
    if (authentication == null || !(targetId instanceof UUID id)) {
      return false;
    }
    Action action;
    try {
      action = Action.valueOf(String.valueOf(permission));
    } catch (IllegalArgumentException e) {
      return false;
    }
    permissions.require(targetType, id, action);
    return true;
  }
}
