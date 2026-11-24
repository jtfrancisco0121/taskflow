package com.taskflow.workspace.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Role;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Workspaces and their members (WS-1, AUTH-3). */
@Service
class WorkspaceService {

  record WorkspaceView(UUID id, String name, String key, Role role, Instant createdAt) {}

  record MemberView(UUID userId, String email, String displayName, Role role, Instant joinedAt) {}

  private static final RowMapper<WorkspaceView> WORKSPACE =
      (rs, i) ->
          new WorkspaceView(
              rs.getObject("id", UUID.class),
              rs.getString("name"),
              rs.getString("key"),
              Role.valueOf(rs.getString("role")),
              rs.getTimestamp("created_at").toInstant());

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final PermissionService permissions;
  private final MembershipLookup memberships;
  private final UserDirectory users;

  WorkspaceService(
      JdbcTemplate jdbc,
      EventRecorder events,
      PermissionService permissions,
      MembershipLookup memberships,
      UserDirectory users) {
    this.jdbc = jdbc;
    this.events = events;
    this.permissions = permissions;
    this.memberships = memberships;
    this.users = users;
  }

  @Transactional
  WorkspaceView create(String name, String requestedKey) {
    UUID userId = CurrentActor.userId();
    String key = requestedKey != null ? requestedKey : deriveKey(name);
    UUID id = Ids.newId();
    jdbc.update("INSERT INTO workspace (id, name, key) VALUES (?, ?, ?)", id, name.trim(), key);
    jdbc.update(
        "INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, 'OWNER')",
        id,
        userId);
    events.record(
        id, "workspace", id, "workspace.created", Map.of("name", name.trim(), "key", key));
    return view(id, userId);
  }

  @Transactional(readOnly = true)
  Page<WorkspaceView> list(String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    List<WorkspaceView> rows =
        jdbc.query(
            "SELECT w.id, w.name, w.key, w.created_at, m.role FROM workspace w JOIN workspace_member m"
                + " ON m.workspace_id = w.id WHERE m.user_id = ? AND w.deleted_at IS NULL"
                + (after == null ? "" : " AND w.id > ?")
                + " ORDER BY w.id LIMIT ?",
            WORKSPACE,
            after == null
                ? new Object[] {CurrentActor.userId(), limit + 1}
                : new Object[] {CurrentActor.userId(), UUID.fromString(after.get(0)), limit + 1});
    return PageCursor.page(rows, limit, w -> PageCursor.encode(w.id().toString()));
  }

  @Transactional(readOnly = true)
  WorkspaceView get(UUID id) {
    return view(id, CurrentActor.userId());
  }

  @Transactional
  WorkspaceView rename(UUID id, String name) {
    String before =
        jdbc.queryForObject("SELECT name FROM workspace WHERE id = ?", String.class, id);
    jdbc.update("UPDATE workspace SET name = ? WHERE id = ?", name.trim(), id);
    Map<String, Object> change = new LinkedHashMap<>();
    change.put("from", before);
    change.put("to", name.trim());
    events.record(id, "workspace", id, "workspace.renamed", Map.of("name", change));
    return view(id, CurrentActor.userId());
  }

  @Transactional
  void delete(UUID id) {
    jdbc.update("UPDATE workspace SET deleted_at = now() WHERE id = ? AND deleted_at IS NULL", id);
    events.record(id, "workspace", id, "workspace.deleted", Map.of());
  }

  @Transactional(readOnly = true)
  Page<MemberView> members(UUID workspaceId, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    record Row(UUID userId, Role role, Instant joinedAt) {}
    List<Row> rows =
        jdbc.query(
            "SELECT user_id, role, joined_at FROM workspace_member WHERE workspace_id = ?"
                + (after == null ? "" : " AND user_id > ?")
                + " ORDER BY user_id LIMIT ?",
            (rs, i) ->
                new Row(
                    rs.getObject("user_id", UUID.class),
                    Role.valueOf(rs.getString("role")),
                    rs.getTimestamp("joined_at").toInstant()),
            after == null
                ? new Object[] {workspaceId, limit + 1}
                : new Object[] {workspaceId, UUID.fromString(after.get(0)), limit + 1});
    Map<UUID, UserInfo> info = users.byIds(rows.stream().map(Row::userId).toList());
    Page<Row> page = PageCursor.page(rows, limit, r -> PageCursor.encode(r.userId().toString()));
    return new Page<>(
        page.items().stream()
            .map(r -> {
              UserInfo u = info.get(r.userId());
              return new MemberView(
                  r.userId(),
                  u == null ? null : u.email(),
                  u == null ? null : u.displayName(),
                  r.role(),
                  r.joinedAt());
            })
            .toList(),
        page.nextCursor());
  }

  @Transactional
  MemberView changeRole(UUID workspaceId, UUID userId, Role newRole) {
    Role caller = permissions.roleInWorkspace(workspaceId);
    lockWorkspace(workspaceId);
    Role current = memberRole(workspaceId, userId);
    if (caller != Role.OWNER && (current == Role.OWNER || newRole == Role.OWNER)) {
      throw TaskflowException.forbidden(
          "member.owner_protected", "Only an owner can change or grant the owner role");
    }
    if (current == Role.OWNER && newRole != Role.OWNER) {
      requireAnotherOwner(workspaceId);
    }
    jdbc.update(
        "UPDATE workspace_member SET role = ? WHERE workspace_id = ? AND user_id = ?",
        newRole.name(),
        workspaceId,
        userId);
    memberships.invalidate();
    events.record(
        workspaceId,
        "member",
        userId,
        "member.role_changed",
        Map.of("role", Map.of("from", current.name(), "to", newRole.name())));
    return members(workspaceId, null, 200).items().stream()
        .filter(m -> m.userId().equals(userId))
        .findFirst()
        .orElseThrow();
  }

  @Transactional
  void remove(UUID workspaceId, UUID userId) {
    Role caller = permissions.roleInWorkspace(workspaceId);
    lockWorkspace(workspaceId);
    Role current = memberRole(workspaceId, userId);
    if (caller != Role.OWNER && current == Role.OWNER) {
      throw TaskflowException.forbidden(
          "member.owner_protected", "Only an owner can remove an owner");
    }
    removeLocked(workspaceId, userId, current, "removed");
  }

  @Transactional
  void leave(UUID workspaceId) {
    UUID userId = CurrentActor.userId();
    permissions.roleInWorkspace(workspaceId);
    lockWorkspace(workspaceId);
    Role current = memberRole(workspaceId, userId);
    removeLocked(workspaceId, userId, current, "left");
  }

  private void removeLocked(UUID workspaceId, UUID userId, Role current, String reason) {
    if (current == Role.OWNER) {
      requireAnotherOwner(workspaceId);
    }
    jdbc.update(
        "DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?", workspaceId, userId);
    memberships.invalidate();
    events.record(
        workspaceId,
        "member",
        userId,
        "member.removed",
        Map.of("role", current.name(), "reason", reason));
  }

  private void requireAnotherOwner(UUID workspaceId) {
    Integer owners =
        jdbc.queryForObject(
            "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND role = 'OWNER'",
            Integer.class,
            workspaceId);
    if (owners == null || owners <= 1) {
      throw TaskflowException.conflict(
          "member.last_owner", "A workspace must keep at least one owner");
    }
  }

  private Role memberRole(UUID workspaceId, UUID userId) {
    Optional<String> role =
        jdbc
            .queryForList(
                "SELECT role FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
                String.class,
                workspaceId,
                userId)
            .stream()
            .findFirst();
    return role.map(Role::valueOf)
        .orElseThrow(() -> TaskflowException.notFound("member.not_found", "Member not found"));
  }

  private void lockWorkspace(UUID workspaceId) {
    jdbc.query("SELECT 1 FROM workspace WHERE id = ? FOR UPDATE", rs -> {}, workspaceId);
  }

  private WorkspaceView view(UUID id, UUID userId) {
    return jdbc
        .query(
            "SELECT w.id, w.name, w.key, w.created_at, m.role FROM workspace w JOIN workspace_member m"
                + " ON m.workspace_id = w.id WHERE w.id = ? AND m.user_id = ? AND w.deleted_at IS NULL",
            WORKSPACE,
            id,
            userId)
        .stream()
        .findFirst()
        .orElseThrow(
            () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
  }

  static String deriveKey(String name) {
    String letters = name.toUpperCase(java.util.Locale.ROOT).replaceAll("[^A-Z]", "");
    if (letters.length() < 2) {
      return "WS";
    }
    return letters.substring(0, Math.min(4, letters.length()));
  }
}
