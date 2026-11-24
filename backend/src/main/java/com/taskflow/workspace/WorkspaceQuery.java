package com.taskflow.workspace;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Public lookups of workspaces and memberships for other modules. */
public interface WorkspaceQuery {

  /** The user's role, or empty when the workspace is missing, deleted or the user is no member. */
  Optional<Role> roleOf(UUID workspaceId, UUID userId);

  /** The workspace key (for example TF), when the workspace is live. */
  Optional<String> keyOf(UUID workspaceId);

  /** Which of the given users are members of the workspace. */
  Set<UUID> membersAmong(UUID workspaceId, Collection<UUID> userIds);
}
