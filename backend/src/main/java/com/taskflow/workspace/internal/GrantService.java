package com.taskflow.workspace.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Access grants on private locations (LOC-3). */
@Service
class GrantService {

  record GrantView(
      UUID userId, String email, String displayName, UUID grantedBy, Instant createdAt) {}

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final UserDirectory users;
  private final WorkspaceLock lock;

  GrantService(JdbcTemplate jdbc, EventRecorder events, UserDirectory users, WorkspaceLock lock) {
    this.jdbc = jdbc;
    this.events = events;
    this.users = users;
    this.lock = lock;
  }

  @Transactional(readOnly = true)
  Page<GrantView> list(UUID locationId, String cursor, Integer requestedLimit) {
    UUID workspaceId = workspaceOf(locationId);
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    record Row(UUID userId, UUID grantedBy, Instant createdAt) {}
    List<Row> rows =
        jdbc.query(
            "SELECT user_id, granted_by, created_at FROM location_grant WHERE workspace_id = ? AND"
                + " location_id = ?"
                + (after == null ? "" : " AND user_id > ?")
                + " ORDER BY user_id LIMIT ?",
            (rs, i) ->
                new Row(
                    rs.getObject("user_id", UUID.class),
                    rs.getObject("granted_by", UUID.class),
                    rs.getTimestamp("created_at").toInstant()),
            after == null
                ? new Object[] {workspaceId, locationId, limit + 1}
                : new Object[] {
                  workspaceId,
                  locationId,
                  com.taskflow.shared.PageCursor.uuid(after.get(0)),
                  limit + 1
                });
    Map<UUID, UserInfo> info = users.byIds(rows.stream().map(Row::userId).toList());
    Page<Row> page = PageCursor.page(rows, limit, r -> PageCursor.encode(r.userId().toString()));
    return new Page<>(
        page.items().stream()
            .map(r -> {
              UserInfo u = info.get(r.userId());
              return new GrantView(
                  r.userId(),
                  u == null ? null : u.email(),
                  u == null ? null : u.displayName(),
                  r.grantedBy(),
                  r.createdAt());
            })
            .toList(),
        page.nextCursor());
  }

  @Transactional
  void grant(UUID locationId, UUID userId) {
    UUID workspaceId = workspaceOf(locationId);
    lock.lock(workspaceId);
    Integer member =
        jdbc.queryForObject(
            "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
            Integer.class,
            workspaceId,
            userId);
    if (member == null || member == 0) {
      throw TaskflowException.notFound("member.not_found", "Member not found");
    }
    int inserted =
        jdbc.update(
            "INSERT INTO location_grant (workspace_id, location_id, user_id, granted_by) VALUES (?,"
                + " ?, ?, ?) ON CONFLICT DO NOTHING",
            workspaceId,
            locationId,
            userId,
            CurrentActor.userId());
    if (inserted > 0) {
      events.record(
          workspaceId,
          "location",
          locationId,
          "location.access_granted",
          Map.of("userId", userId.toString()));
    }
  }

  @Transactional
  void revoke(UUID locationId, UUID userId) {
    UUID workspaceId = workspaceOf(locationId);
    lock.lock(workspaceId);
    int deleted =
        jdbc.update(
            "DELETE FROM location_grant WHERE workspace_id = ? AND location_id = ? AND user_id = ?",
            workspaceId,
            locationId,
            userId);
    if (deleted > 0) {
      events.record(
          workspaceId,
          "location",
          locationId,
          "location.access_revoked",
          Map.of("userId", userId.toString()));
    }
  }

  private UUID workspaceOf(UUID locationId) {
    return jdbc
        .queryForList(
            "SELECT workspace_id FROM location WHERE id = ? AND deleted_at IS NULL",
            UUID.class,
            locationId)
        .stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("location.not_found", "Location not found"));
  }
}
