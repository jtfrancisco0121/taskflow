package com.taskflow.workspace.internal;

import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/** Role lookup with a per-request cache (AD-3): one query per workspace and caller. */
@Component
class MembershipLookup {

  private static final String ATTRIBUTE = MembershipLookup.class.getName() + ".roles";

  private final WorkspaceQuery query;

  MembershipLookup(WorkspaceQuery query) {
    this.query = query;
  }

  @SuppressWarnings("unchecked")
  Optional<Role> role(UUID workspaceId, UUID userId) {
    RequestAttributes request = RequestContextHolder.getRequestAttributes();
    if (request == null) {
      return query.roleOf(workspaceId, userId);
    }
    Map<String, Optional<Role>> cache =
        (Map<String, Optional<Role>>)
            request.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
    if (cache == null) {
      cache = new HashMap<>();
      request.setAttribute(ATTRIBUTE, cache, RequestAttributes.SCOPE_REQUEST);
    }
    return cache.computeIfAbsent(
        workspaceId + ":" + userId, k -> query.roleOf(workspaceId, userId));
  }

  /** Drops the cache, after a request changed memberships. */
  void invalidate() {
    RequestAttributes request = RequestContextHolder.getRequestAttributes();
    if (request != null) {
      request.removeAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
    }
  }
}
