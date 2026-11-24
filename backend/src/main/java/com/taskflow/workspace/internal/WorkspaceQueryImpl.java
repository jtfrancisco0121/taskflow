package com.taskflow.workspace.internal;

import com.taskflow.identity.ServiceAccounts;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.Collection;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class WorkspaceQueryImpl implements WorkspaceQuery {

  private final JdbcTemplate jdbc;
  private final ServiceAccounts serviceAccounts;

  WorkspaceQueryImpl(JdbcTemplate jdbc, ServiceAccounts serviceAccounts) {
    this.jdbc = jdbc;
    this.serviceAccounts = serviceAccounts;
  }

  /**
   * A member has the role of their workspace_member row. A service account is never a member: it is
   * ADMIN in the one Workspace it belongs to and has no role anywhere else (SA-2).
   */
  @Override
  public Optional<Role> roleOf(UUID workspaceId, UUID userId) {
    Optional<Role> member = memberRole(workspaceId, userId);
    if (member.isPresent()) {
      return member;
    }
    return serviceAccounts
        .workspaceOf(userId)
        .filter(workspaceId::equals)
        .filter(this::isLive)
        .map(w -> Role.ADMIN);
  }

  private boolean isLive(UUID workspaceId) {
    return !jdbc.queryForList(
            "SELECT 1 FROM workspace WHERE id = ? AND deleted_at IS NULL",
            Integer.class,
            workspaceId)
        .isEmpty();
  }

  private Optional<Role> memberRole(UUID workspaceId, UUID userId) {
    return jdbc
        .queryForList(
            "SELECT m.role FROM workspace_member m JOIN workspace w ON w.id = m.workspace_id"
                + " WHERE m.workspace_id = ? AND m.user_id = ? AND w.deleted_at IS NULL",
            String.class,
            workspaceId,
            userId)
        .stream()
        .findFirst()
        .map(Role::valueOf);
  }

  @Override
  public Optional<String> keyOf(UUID workspaceId) {
    return jdbc
        .queryForList(
            "SELECT key FROM workspace WHERE id = ? AND deleted_at IS NULL",
            String.class,
            workspaceId)
        .stream()
        .findFirst();
  }

  @Override
  public Set<UUID> membersAmong(UUID workspaceId, Collection<UUID> userIds) {
    Set<UUID> out = new HashSet<>();
    if (userIds.isEmpty()) {
      return out;
    }
    String marks = String.join(",", java.util.Collections.nCopies(userIds.size(), "?"));
    Object[] args = new Object[userIds.size() + 1];
    args[0] = workspaceId;
    int i = 1;
    for (UUID id : userIds) {
      args[i++] = id;
    }
    out.addAll(
        jdbc.queryForList(
            "SELECT user_id FROM workspace_member WHERE workspace_id = ? AND user_id IN ("
                + marks
                + ")",
            UUID.class,
            args));
    return out;
  }
}
